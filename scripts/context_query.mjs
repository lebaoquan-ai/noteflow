#!/usr/bin/env node
/**
 * NoteFlow Context Engineering & Deterministic Gate Utility
 *
 * Implements:
 * 1. AST Symbol-Level Context Injection (`symbols <path>`, `symbol <Name>`)
 *    Uses the TypeScript Compiler AST (`ts.createSourceFile`) to extract exact
 *    line ranges (`StartLine`-`EndLine`) and signatures without dumping full
 *    file implementations into the LLM context window.
 * 2. Deterministic Pre-Filtered TDD Verification Gate (`gate`)
 *    Runs `tsc --noEmit`, Pure-Core invariant checks (`src/core/**`), and
 *    `vitest run tests/headless --reporter=dot --bail=1`, emitting a compact
 *    schema-constrained JSON summary (<150 tokens).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();

/**
 * Recursively collect `.ts` files under given directories.
 * @param {string} dir
 * @param {string[]} acc
 */
function collectTsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (dir.endsWith('.ts') || dir.endsWith('.tsx')) acc.push(dir);
    return acc;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, acc);
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Extract compact signature header (without body block) from AST node text.
 */
function compactSignature(sourceText, node) {
  const raw = sourceText.slice(node.getStart(), node.getEnd());
  const braceIdx = raw.indexOf('{');
  const eqBraceIdx = raw.indexOf('=>');
  let header = raw;
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) {
    if (braceIdx !== -1) header = raw.slice(0, braceIdx).trim();
  } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    // Keep compact single-line summary up to 140 chars
    header = raw.replace(/\s+/g, ' ').trim();
    if (header.length > 140) header = `${header.slice(0, 137)}...`;
  } else if (eqBraceIdx !== -1 && braceIdx !== -1) {
    header = raw.slice(0, Math.min(braceIdx, 140)).trim();
  }
  return header.replace(/\s+/g, ' ').slice(0, 140);
}

/**
 * Parse a TypeScript file into symbol descriptors with 1-based line numbers.
 */
function extractFileSymbols(filePath) {
  const absPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absPath)) return [];
  const sourceText = fs.readFileSync(absPath, 'utf8');
  const sf = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(ROOT, absPath);
  const symbols = [];

  const getLine = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  function visit(node, parentName = '') {
    const startLine = getLine(node.getStart(sf));
    const endLine = getLine(node.getEnd());

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      symbols.push({
        kind: 'class',
        name: className,
        file: relPath,
        lines: `L${startLine}-L${endLine}`,
        signature: compactSignature(sourceText, node),
      });
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name) {
          const mName = member.name.getText(sf);
          const mStart = getLine(member.getStart(sf));
          const mEnd = getLine(member.getEnd());
          symbols.push({
            kind: ts.isMethodDeclaration(member) ? 'method' : 'property',
            name: `${className}.${mName}`,
            file: relPath,
            lines: `L${mStart}-L${mEnd}`,
            signature: compactSignature(sourceText, member),
          });
        }
      }
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      symbols.push({
        kind: 'interface',
        name: node.name.text,
        file: relPath,
        lines: `L${startLine}-L${endLine}`,
        signature: compactSignature(sourceText, node),
      });
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({
        kind: 'type',
        name: node.name.text,
        file: relPath,
        lines: `L${startLine}-L${endLine}`,
        signature: compactSignature(sourceText, node),
      });
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        kind: 'function',
        name: node.name.text,
        file: relPath,
        lines: `L${startLine}-L${endLine}`,
        signature: compactSignature(sourceText, node),
      });
      return;
    }

    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            symbols.push({
              kind: 'const',
              name: decl.name.text,
              file: relPath,
              lines: `L${startLine}-L${endLine}`,
              signature: compactSignature(sourceText, node),
            });
          }
        }
      }
      return;
    }

    ts.forEachChild(node, (child) => visit(child, parentName));
  }

  visit(sf);
  return symbols;
}

/**
 * Command: `symbols <file-or-dir>`
 * Prints compact AST outline with exact StartLine-EndLine ranges.
 */
function cmdSymbols(target) {
  if (!target) {
    console.error('Usage: npm run ctx -- symbols <file-or-dir>');
    process.exit(1);
  }
  const files = collectTsFiles(path.resolve(ROOT, target));
  const results = [];
  for (const f of files) {
    results.push(...extractFileSymbols(f));
  }
  for (const s of results) {
    console.log(`${s.file}:${s.lines} [${s.kind}] ${s.name} -> ${s.signature}`);
  }
}

/**
 * Command: `symbol <QueryName>`
 * Locates exact symbol definitions and up to 15 call/reference sites across src/ and tests/.
 */
function cmdSymbol(query) {
  if (!query) {
    console.error('Usage: npm run ctx -- symbol <SymbolName>');
    process.exit(1);
  }
  const files = [...collectTsFiles(path.join(ROOT, 'src')), ...collectTsFiles(path.join(ROOT, 'tests'))];
  const definitions = [];
  const references = [];
  const needle = query.includes('.') ? query.split('.').pop() : query;

  for (const f of files) {
    const syms = extractFileSymbols(f);
    for (const s of syms) {
      if (s.name === query || s.name.endsWith(`.${query}`) || s.name.toLowerCase().includes(query.toLowerCase())) {
        definitions.push(s);
      }
    }
    if (needle && references.length < 15) {
      const rel = path.relative(ROOT, f);
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(needle)) {
          references.push(`${rel}:L${i + 1}: ${lines[i].trim().slice(0, 100)}`);
          if (references.length >= 15) break;
        }
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        query,
        definitions: definitions.slice(0, 12),
        references,
      },
      null,
      2
    )
  );
}

/**
 * Verify architectural invariants in `src/core/**` (Zero React/DOM/src/ui imports, zero `window.` globals).
 */
function checkArchitecturalInvariants() {
  const issues = [];
  const coreFiles = collectTsFiles(path.join(ROOT, 'src', 'core'));
  for (const f of coreFiles) {
    const rel = path.relative(ROOT, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/from\s+['"](react|.*\/ui\/|\.\.\/\.\.\/ui)/.test(line)) {
        issues.push({
          file: rel,
          line: i + 1,
          severity: 'high',
          rule: 'PURE_CORE_IMPORT',
          message: `Forbidden UI/React import in src/core: ${line.trim()}`,
        });
      }
      if (/\b(document|HTMLElement|HTMLCanvasElement)\b/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        issues.push({
          file: rel,
          line: i + 1,
          severity: 'high',
          rule: 'PURE_CORE_DOM',
          message: `Forbidden DOM global in src/core: ${line.trim()}`,
        });
      }
    }
  }

  const allSrcFiles = collectTsFiles(path.join(ROOT, 'src'));
  const allowedUiWindowApis =
    /\bwindow\.(innerWidth|innerHeight|devicePixelRatio|addEventListener|removeEventListener|requestAnimationFrame|cancelAnimationFrame|setTimeout|clearTimeout|matchMedia)\b/;
  for (const f of allSrcFiles) {
    const rel = path.relative(ROOT, f);
    const isUiFile = rel.startsWith(`src${path.sep}ui${path.sep}`);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bwindow\./.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        if (isUiFile && allowedUiWindowApis.test(line)) continue;
        issues.push({
          file: rel,
          line: i + 1,
          severity: 'high',
          rule: 'NO_WINDOW_GLOBAL',
          message: `Forbidden window.* state access: ${line.trim()}`,
        });
      }
    }
  }
  return issues;
}

/**
 * Command: `gate`
 * Runs deterministic TDD & Architectural Verification Gate and outputs compact JSON schema.
 */
function cmdGate() {
  const start = Date.now();
  const issues = [];

  // 1. Architectural Invariants Check
  const invariantIssues = checkArchitecturalInvariants();
  issues.push(...invariantIssues);

  // 2. TypeScript Compiler Check (`tsc --noEmit`)
  const tscRun = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (tscRun.status !== 0) {
    const rawLines = `${tscRun.stdout || ''}\n${tscRun.stderr || ''}`
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 15);
    for (const line of rawLines) {
      issues.push({
        file: line.split('(')[0] || 'tsconfig.json',
        line: 0,
        severity: 'high',
        rule: 'TYPECHECK',
        message: line,
      });
    }
  }

  // 3. Headless Vitest Suite (`vitest run tests/headless --reporter=dot --bail=1`)
  let testSummary = 'SKIPPED';
  if (issues.length === 0) {
    const vitestRun = spawnSync(
      'npx',
      ['vitest', 'run', 'tests/headless', '--reporter=dot', '--bail=1'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );
    const combined = `${vitestRun.stdout || ''}\n${vitestRun.stderr || ''}`;
    if (vitestRun.status !== 0) {
      const failLines = combined
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('RUN '))
        .slice(-20);
      issues.push({
        file: 'tests/headless',
        line: 0,
        severity: 'high',
        rule: 'VITEST_HEADLESS',
        message: failLines.join(' | ').slice(0, 500),
      });
      testSummary = 'FAILED';
    } else {
      const match = combined.match(/Tests\s+(\d+\s+passed\s*\(\d+\))/);
      testSummary = match ? match[1] : 'PASSED';
    }
  }

  const output = {
    status: issues.length === 0 ? 'PASS' : 'FAIL',
    typecheck: tscRun.status === 0 ? 'OK' : 'FAIL',
    invariants: invariantIssues.length === 0 ? 'OK' : 'FAIL',
    headlessTests: testSummary,
    durationMs: Date.now() - start,
    issues,
  };

  console.log(JSON.stringify(output));
  process.exit(issues.length === 0 ? 0 : 1);
}

const [, , subcommand, arg] = process.argv;
switch (subcommand) {
  case 'symbols':
    cmdSymbols(arg);
    break;
  case 'symbol':
    cmdSymbol(arg);
    break;
  case 'gate':
    cmdGate();
    break;
  default:
    console.log(
      'Usage:\n' +
        '  npm run ctx -- symbols <file-or-dir>   # AST symbol outline with exact Lstart-Lend ranges\n' +
        '  npm run ctx -- symbol <SymbolName>     # Exact AST definition + compact call sites JSON\n' +
        '  npm run verify:gate                    # Deterministic JSON verification gate (tsc + invariants + vitest --bail=1)'
    );
    break;
}
