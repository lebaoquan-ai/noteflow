import {
  type CanvasId,
  type LayerId,
  type NodeId,
  type WorldAABB,
} from '../../core/canvas/types.js';
import type { NoteFlowDatabase } from '../../db/client.js';
import type {
  SpatialNodeRecord,
  SpatialNodeRepository,
} from '../../db/repositories/spatial_node_repository.js';
import {
  zettelId,
  type AgendaTaskRecord,
  type CanvasBlockRecord,
  type SpatialRelationRecord,
  type ZettelEvidenceLinkRecord,
  type ZettelId,
  type ZettelKeywordRecord,
  type ZettelRepository,
} from '../../db/repositories/zettel_repository.js';
import type {
  ClusterAnalysisResult,
  InkRecognitionPort,
} from '../ink_recognition/recognition_port.js';
import {
  normalizeKeywordToken,
  VectorTopologyAnalyzer,
} from '../ink_recognition/vector_topology_analyzer.js';
import type { Tier0StrokeClusterer } from '../tier0_clustering/stroke_clusterer.js';

function pointToBoxDistance(x: number, y: number, box: WorldAABB): number {
  const dx = x < box[0] ? box[0] - x : x > box[2] ? x - box[2] : 0;
  const dy = y < box[1] ? box[1] - y : y > box[3] ? y - box[3] : 0;
  return Math.hypot(dx, dy);
}

function horizontalBoxDistance(a: WorldAABB, b: WorldAABB): number {
  if (a[2] < b[0]) return b[0] - a[2];
  if (b[2] < a[0]) return a[0] - b[2];
  return 0;
}

export class AutoZettelSyncer {
  private readonly recognizer: InkRecognitionPort;

  public constructor(
    private readonly db: NoteFlowDatabase,
    private readonly nodeRepo: SpatialNodeRepository,
    private readonly zettelRepo: ZettelRepository,
    private readonly clusterer: Tier0StrokeClusterer,
    recognizer?: InkRecognitionPort
  ) {
    this.recognizer = recognizer ?? new VectorTopologyAnalyzer();
  }

  /**
   * Synchronizes the Canvas Layer with the Multimodal Zettelkasten Database:
   * 1. Runs Tier-0 spatial stroke clustering (excluding pointing-arrow connectors).
   * 2. Registers 100% of canvas clusters into `canvas_blocks` (`prose_explanation`,
   *    `sketch_diagram`, `comparison_table`, `math_expression`, `ordered_list`).
   * 3. Detects directed `pointing_arrow` connectors between clusters in `spatial_relations`.
   * 4. Selectively promotes ONLY symbol-marked keywords (`circle`, `underline`,
   *    `double_underline`, `#tag`, `!axiom`, `?inquiry`, `@entity`) into `zettel_keywords`
   *    and Atomic Zettel anchors in `zettels`.
   * 5. Binds multimodal supporting evidence (`sketch_diagram`, `comparison_table`,
   *    unmarked `prose_explanation`) to Atomic Zettels via `zettel_evidence_links`
   *    and updates each Zettel's `summary_markdown`.
   * 6. Extracts `[ ]` / `[x]` / `@YYYY-MM-DD` items into `agenda_tasks`.
   */
  public syncLayer(targetCanvasId: CanvasId, targetLayerId: LayerId): void {
    // Step 1: Ensure all non-connector unclustered strokes are grouped into stroke_clusters
    this.clusterer.clusterLayerNow(targetCanvasId, targetLayerId);

    this.db.transaction(() => {
      const clusters = this.nodeRepo.getClustersInLayer(
        targetCanvasId,
        targetLayerId
      );
      const currentClusterIds = new Set<NodeId>(clusters.map((c) => c.id));

      // Step 2: Clean up stale canvas_blocks whose cluster was erased or undone
      const existingBlocks = this.zettelRepo.getCanvasBlocks(targetCanvasId);
      const blockByNodeId = new Map<NodeId, CanvasBlockRecord>();
      for (const blk of existingBlocks) {
        if (!currentClusterIds.has(blk.spatialNodeId)) {
          this.zettelRepo.deleteCanvasBlock(blk.id);
        } else {
          blockByNodeId.set(blk.spatialNodeId, blk);
        }
      }

      // Analyze every cluster and upsert 100% into canvas_blocks
      const analysisByClusterId = new Map<NodeId, ClusterAnalysisResult>();
      const activeBlockByClusterId = new Map<NodeId, CanvasBlockRecord>();
      const now = Date.now();

      for (const cluster of clusters) {
        const memberStrokes = this.nodeRepo.getChildStrokesOfClusters([
          cluster.id,
        ]);
        const analysis = this.recognizer.analyzeCluster(cluster, memberStrokes);
        analysisByClusterId.set(cluster.id, analysis);

        // Update cluster node metadata so DualCanvasRenderer can render subtle keyword chips
        const nextTags = [
          ...new Set([
            ...cluster.semanticTags,
            ...analysis.sigils.hashTags.map((t) => `#${t}`),
          ]),
        ];
        this.nodeRepo.updateNodeMetadata(cluster.id, {
          contentJson: {
            ...(cluster.contentJson ?? {}),
            strokeCount: memberStrokes.length,
            modality: analysis.modality,
            promotedKeywords: analysis.promotedKeywords.map(
              (k) => k.keywordText
            ),
          },
          ocrText: analysis.rawText,
          semanticTags: nextTags,
        });

        const existingBlk = blockByNodeId.get(cluster.id);
        const blockRecord: CanvasBlockRecord = {
          id: existingBlk?.id ?? crypto.randomUUID(),
          canvasId: targetCanvasId,
          layerId: targetLayerId,
          spatialNodeId: cluster.id,
          modality: analysis.modality,
          rawText: analysis.rawText,
          normalizedTokens: analysis.normalizedTokens,
          structuralMetadata: analysis.structuralMetadata,
          bbox: analysis.bbox,
          updatedAt: now,
        };
        const savedBlock = this.zettelRepo.upsertCanvasBlock(blockRecord);
        activeBlockByClusterId.set(cluster.id, savedBlock);
      }

      // Step 3: Detect pointing_arrow connector strokes in the layer
      const unclusteredStrokes = this.nodeRepo.getUnclusteredStrokesInLayer(
        targetCanvasId,
        targetLayerId
      );
      const spatialRelations: SpatialRelationRecord[] = [];
      for (const stroke of unclusteredStrokes) {
        const arrow = this.recognizer.detectPointingArrow(stroke);
        if (!arrow) continue;

        let sourceCluster: SpatialNodeRecord | null = null;
        let minSourceDist = Infinity;
        for (const c of clusters) {
          const d = pointToBoxDistance(arrow.tailX, arrow.tailY, c.bbox);
          if (d < minSourceDist) {
            minSourceDist = d;
            sourceCluster = c;
          }
        }

        let targetCluster: SpatialNodeRecord | null = null;
        let minTargetDist = Infinity;
        for (const c of clusters) {
          if (sourceCluster && c.id === sourceCluster.id) continue;
          const d = pointToBoxDistance(arrow.tipX, arrow.tipY, c.bbox);
          if (d < minTargetDist) {
            minTargetDist = d;
            targetCluster = c;
          }
        }

        if (
          sourceCluster &&
          targetCluster &&
          minSourceDist <= 140 &&
          minTargetDist <= 140
        ) {
          spatialRelations.push({
            id: crypto.randomUUID(),
            canvasId: targetCanvasId,
            connectorStrokeId: stroke.id,
            sourceClusterId: sourceCluster.id,
            targetClusterId: targetCluster.id,
            relationType: 'pointing_arrow',
            confidence: arrow.confidence,
            createdAt: now,
          });
        }
      }
      this.zettelRepo.replaceSpatialRelationsForCanvas(
        targetCanvasId,
        spatialRelations
      );

      // Step 4: Promote ONLY symbol-marked keywords into zettel_keywords & zettels
      const existingZettels = this.zettelRepo.getAllZettels();
      const zettelByNormalizedTitle = new Map<string, ZettelId>();
      for (const z of existingZettels) {
        zettelByNormalizedTitle.set(normalizeKeywordToken(z.title), z.id);
      }

      const activeZettelIds = new Set<ZettelId>();
      const zettelAnchorCluster = new Map<ZettelId, NodeId>();
      const keywordRecords: ZettelKeywordRecord[] = [];

      for (const cluster of clusters) {
        const analysis = analysisByClusterId.get(cluster.id)!;
        const block = activeBlockByClusterId.get(cluster.id)!;

        for (const kw of analysis.promotedKeywords) {
          const zId =
            zettelByNormalizedTitle.get(kw.normalizedKeyword) ??
            zettelId(crypto.randomUUID());
          zettelByNormalizedTitle.set(kw.normalizedKeyword, zId);
          activeZettelIds.add(zId);
          zettelAnchorCluster.set(zId, cluster.id);

          const isPrimary =
            kw.markerType === 'double_underline' ||
            kw.markerType === 'bang_axiom' ||
            kw.markerType === 'circle';

          this.zettelRepo.updateZettel({
            id: zId,
            spatialNodeId: cluster.id,
            title: kw.keywordText,
            summaryMarkdown: analysis.sigils.cleanText || analysis.rawText,
            verificationState:
              analysis.sigils.bangAxioms.length > 0 ? 'verified' : 'unverified',
          });

          keywordRecords.push({
            id: crypto.randomUUID(),
            zettelId: zId,
            canvasBlockId: block.id,
            keywordText: kw.keywordText,
            normalizedKeyword: kw.normalizedKeyword,
            markerType: kw.markerType,
            isPrimaryConcept: isPrimary,
            gestureStrokeId: kw.gestureStrokeId as NodeId | null,
            confidence: kw.confidence,
            createdAt: now,
          });
        }
      }

      this.zettelRepo.replaceZettelKeywordsForCanvas(
        targetCanvasId,
        keywordRecords
      );

      // Remove any stale Zettels whose cluster was erased or whose keyword marker was removed
      for (const z of existingZettels) {
        if (!activeZettelIds.has(z.id)) {
          this.zettelRepo.deleteById(z.id);
        }
      }

      // Step 5: 4-Tier Multimodal Evidence Binding (linking sketches, tables, and prose to Zettels)
      for (const zId of activeZettelIds) {
        const anchorClusterId = zettelAnchorCluster.get(zId);
        if (!anchorClusterId) continue;
        const anchorBlock = activeBlockByClusterId.get(anchorClusterId);
        const anchorAnalysis = analysisByClusterId.get(anchorClusterId);
        if (!anchorBlock || !anchorAnalysis) continue;

        const evidenceLinks: ZettelEvidenceLinkRecord[] = [];
        const linkedBlockIds = new Set<string>();

        const addEvidence = (
          blk: CanvasBlockRecord,
          role: ZettelEvidenceLinkRecord['relationType'],
          connectorId: NodeId | null,
          weight: number
        ): void => {
          if (linkedBlockIds.has(blk.id)) return;
          linkedBlockIds.add(blk.id);
          evidenceLinks.push({
            id: crypto.randomUUID(),
            zettelId: zId,
            canvasBlockId: blk.id,
            blockId: blk.id,
            relationType: role,
            evidenceRole: role,
            connectorStrokeId: connectorId,
            weight,
          });
        };

        // Tier 1: Explicit Pointing Arrow (A ──> B)
        for (const rel of spatialRelations) {
          if (rel.sourceClusterId === anchorClusterId) {
            const targetBlk = activeBlockByClusterId.get(rel.targetClusterId);
            if (targetBlk) {
              addEvidence(
                targetBlk,
                'pointing_arrow_support',
                rel.connectorStrokeId,
                1.0
              );
            }
          } else if (rel.targetClusterId === anchorClusterId) {
            const sourceBlk = activeBlockByClusterId.get(rel.sourceClusterId);
            if (sourceBlk) {
              addEvidence(
                sourceBlk,
                'pointing_arrow_support',
                rel.connectorStrokeId,
                0.95
              );
            }
          }
        }

        // Tier 3: Inline context on the anchor block itself
        addEvidence(anchorBlock, 'inline_context', null, 0.9);

        // Tier 4: Section Flow (supporting tables, sketches, or unmarked prose vertically beneath/aligned)
        for (const otherCluster of clusters) {
          if (otherCluster.id === anchorClusterId) continue;
          const otherAnalysis = analysisByClusterId.get(otherCluster.id);
          const otherBlk = activeBlockByClusterId.get(otherCluster.id);
          if (!otherAnalysis || !otherBlk) continue;

          // Only bind blocks that do NOT define their own independent Atomic Zettel
          if (otherAnalysis.promotedKeywords.length > 0) continue;

          const dy = otherBlk.bbox[1] - anchorBlock.bbox[3];
          const dx = horizontalBoxDistance(anchorBlock.bbox, otherBlk.bbox);
          if (dy >= -30 && dy <= 240 && dx <= 180) {
            addEvidence(otherBlk, 'section_flow', null, 0.75);
          }
        }

        this.zettelRepo.replaceEvidenceLinksForZettel(zId, evidenceLinks);

        // Compile multimodal summaryMarkdown for the Atomic Zettel
        const summaryParts: string[] = [];
        const baseClean =
          anchorAnalysis.sigils.cleanText || anchorAnalysis.rawText;
        if (baseClean) {
          summaryParts.push(baseClean);
        }

        for (const link of evidenceLinks) {
          if (link.canvasBlockId === anchorBlock.id) continue;
          const blk = [...activeBlockByClusterId.values()].find(
            (b) => b.id === link.canvasBlockId
          );
          if (!blk) continue;
          if (blk.modality === 'sketch_diagram') {
            summaryParts.push(`- [Sketch Diagram] ${blk.rawText}`);
          } else if (blk.modality === 'comparison_table') {
            summaryParts.push(`- [Comparison Table] ${blk.rawText}`);
          } else if (blk.modality === 'math_expression') {
            summaryParts.push(`- [Math Expression] ${blk.rawText}`);
          } else {
            summaryParts.push(`- ${blk.rawText}`);
          }
        }

        const currentZettel = this.zettelRepo.getById(zId);
        if (currentZettel) {
          this.zettelRepo.updateZettel({
            id: zId,
            spatialNodeId: currentZettel.spatialNodeId,
            title: currentZettel.title,
            summaryMarkdown: summaryParts.join('\n'),
            verificationState: currentZettel.verificationState,
          });
        }
      }

      // Step 6: Extract [ ] / [x] / @YYYY-MM-DD Agenda Tasks
      const agendaTasks: AgendaTaskRecord[] = [];
      for (const cluster of clusters) {
        const analysis = analysisByClusterId.get(cluster.id)!;
        if (
          analysis.sigils.checkboxState !== 'none' ||
          analysis.sigils.dueDatesIso.length > 0
        ) {
          agendaTasks.push({
            id: crypto.randomUUID(),
            canvasId: targetCanvasId,
            spatialNodeId: cluster.id,
            taskText: analysis.sigils.cleanText || analysis.rawText,
            dueDateIso: analysis.sigils.dueDatesIso[0] ?? null,
            completed: analysis.sigils.checkboxState === 'done',
            updatedAt: now,
          });
        }
      }
      this.zettelRepo.replaceAgendaTasksForCanvas(targetCanvasId, agendaTasks);
    });
  }
}
