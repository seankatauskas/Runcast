import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoots = [
  'packages/core/src',
  'apps/api/src',
  'apps/mobile/app',
  'apps/mobile/src',
  'apps/web/src',
];
const sourceExtensions = new Set(['.ts', '.tsx']);
const retiredRuntimeNames = new Set([
  'computePlan',
  'computeLegacyPlan',
  'recommendLegacyStart',
  'evaluateRun',
  'recommendStart',
  'evaluateRunV2',
  'recommendStartV2',
  'buildRouteConditionsProfileV2',
]);
const retiredModules = new Set([
  'packages/core/src/engine/plan',
  'packages/core/src/engine/planning/compatibility',
  'apps/api/src/jobs/schedulerLegacy',
]);
const retiredFlags =
  /^(?:PLANNING_V2_(?:ENDPOINT|EVALUATION|PUBLICATION)_ENABLED|EXPO_PUBLIC_PLANNING_AUTHORITY)$/;
const rules = [
  {
    label: 'active generation-number local',
    pattern: /\b(?:planV2|routeV2|coverageV2|fieldV2)\b/g,
  },
  {
    label: 'deprecated SUN presentation name',
    pattern:
      /\b(?:SunStrip[A-Za-z]*V1|sunStripSectionV1|buildSunStripBandsV1|SUN_STRIP_SECTION_VERSION)\b/g,
  },
  { label: 'deprecated strip component name', pattern: /\bConditionStrip\b/g },
];

/** Inspect imported/exported names, so a current function may still use a concise local alias. */
export function retiredRuntimeViolations(contents, repositoryPath) {
  if (/\.test\.[cm]?[jt]sx?$/.test(repositoryPath)) return [];
  const source = ts.createSourceFile(repositoryPath, contents, ts.ScriptTarget.Latest, true);
  const violations = [];
  const namespaces = new Set();
  const report = (node, description) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${repositoryPath}:${line + 1}: ${description}`);
  };
  const checkModule = (node, name) => {
    const normalized = name.startsWith('.')
      ? relative(repositoryRoot, resolve(repositoryRoot, dirname(repositoryPath), name)).replace(
          /\.[cm]?[jt]sx?$/,
          '',
        )
      : name;
    if (
      retiredModules.has(normalized) ||
      /(?:^|\/)engine\/(?:plan|planning\/compatibility)(?:\.[cm]?[jt]s)?$/.test(name)
    ) {
      report(node, `retired runtime module: ${name}`);
    }
    return normalized;
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const name = node.moduleSpecifier.text;
      const modulePath = checkModule(node.moduleSpecifier, name);
      const coreModule =
        name === '@runcast/core' || modulePath.startsWith('packages/core/src/engine/');
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (name === '@runcast/core' && bindings && ts.isNamespaceImport(bindings))
        namespaces.add(bindings.name.text);
      if (coreModule && bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (retiredRuntimeNames.has(imported))
            report(element, `retired evaluator import/export: ${imported}`);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      checkModule(node.arguments[0], node.arguments[0].text);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      retiredRuntimeNames.has(node.name.text)
    ) {
      report(node, `retired evaluator namespace access: ${node.name.text}`);
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && retiredFlags.test(node.text))
      report(node, `retired rollout flag: ${node.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return sourceExtensions.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}

async function main() {
  const files = (
    await Promise.all(sourceRoots.map((root) => sourceFiles(resolve(repositoryRoot, root))))
  ).flat();
  const violations = [];
  for (const file of files) {
    const repositoryPath = relative(repositoryRoot, file);
    const contents = await readFile(file, 'utf8');
    for (const rule of rules) {
      for (const match of contents.matchAll(rule.pattern)) {
        const line = contents.slice(0, match.index).split('\n').length;
        violations.push(`${repositoryPath}:${line}: ${rule.label}: ${match[0]}`);
      }
    }
    violations.push(...retiredRuntimeViolations(contents, repositoryPath));
  }
  if (violations.length > 0) {
    console.error('Architecture boundary violations:\n' + violations.join('\n'));
    process.exitCode = 1;
  } else console.log('Naming and current-planning runtime boundaries verified.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
