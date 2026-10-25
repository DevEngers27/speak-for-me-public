import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Layering: core (pure) <- convex (backend) ; core <- src (Next app).
// src may only reach convex through the generated, type-only API surface.
const frameworkImports = [
  { group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*", "@clerk/*"], message: "core/ and convex/ must stay framework-free." },
];

// TypeScript parser/plugin are already supplied by eslint-config-next/typescript.
const publicLogRule = {
  create(context) {
    const imports = [];
    const declarations = new Set();
    const exported = new Set();
    const publicBuilders = new Set(['query', 'mutation', 'action', 'anonQuery', 'userQuery', 'userMutation', 'userAction', 'memberQuery', 'memberMutation']);
    const loggerModule = value => /(?:^|\/)opsLog(?:\.[cm]?[jt]s)?$/.test(value);
    const builderName = init => init?.type === 'CallExpression' ? init.callee.name ?? builderName(init.callee) : undefined;
    return {
      ImportDeclaration(node) {
        if (loggerModule(node.source.value)) imports.push(...node.specifiers.filter(s => s.type === 'ImportNamespaceSpecifier' || (s.imported?.name ?? s.imported?.value) === 'opsLog'));
        if (/functions(?:\.[cm]?[jt]s)?$/.test(node.source.value)) for (const s of node.specifiers) if (publicBuilders.has(s.imported?.name)) publicBuilders.add(s.local.name);
      },
      VariableDeclarator(node) {
        if (publicBuilders.has(builderName(node.init))) declarations.add(node.id.name);
      },
      ExportNamedDeclaration(node) {
        if (node.source && loggerModule(node.source.value)) imports.push(...node.specifiers.filter(s => (s.local?.name ?? s.local?.value) === 'opsLog' || s.type === 'ExportNamespaceSpecifier'));
        if (node.declaration?.type === 'VariableDeclaration') for (const d of node.declaration.declarations) exported.add(d.id.name);
        if (!node.source) for (const spec of node.specifiers) exported.add(spec.local.name);
      },
      ExportAllDeclaration(node) {
        if (loggerModule(node.source.value)) imports.push(node);
      },
      'Program:exit'() {
        if ([...exported].some(name => declarations.has(name)) || /convex\/model\/views\//.test(context.filename)) for (const node of imports) context.report({node, message: 'Public paths may import only publicOpsLog.'});
      },
    };
  },
};
const backendPatterns = [
  { regex: "_generated/server$", importNames: ["query", "mutation", "action", "internalQuery", "internalMutation", "internalAction"], message: "Use sanitized boundary builders." },
  ...frameworkImports,
  { group: ["@/*"], message: "convex/ must not import the Next app." },
  { regex: "^\\.{1,2}/.*src/", message: "convex/ must not import the Next app." },
];

export default defineConfig([
  {
    files: ["convex/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "core/scenarios/**/*.ts"],
    ignores: ["**/*.test.ts", "convex/_generated/**"],
    rules: {"no-restricted-syntax": ["error", {selector: "ImportDeclaration[source.value=/engine\\//]", message: "Use the core/engine barrel as the unique engine entry point."}]},
  },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ['core/**/*.ts', 'convex/**/*.ts'],
    languageOptions: {parserOptions: {projectService: true, tsconfigRootDir: import.meta.dirname}},
    rules: {'@typescript-eslint/no-floating-promises': 'error', '@typescript-eslint/switch-exhaustiveness-check': 'error'},
  },
  {
    files: ['convex/**/*.ts'],
    ignores: ['convex/lib/opsLog.ts', '**/*.test.ts', '**/*.fixture.ts', 'convex/test/**', 'convex/testing/**'],
    rules: {'no-console': 'error'},
  },
  {
    files: ['convex/**/*.ts'],
    plugins: {foundation: {rules: {'public-ops-log': publicLogRule}}},
    rules: {'foundation/public-ops-log': 'error'},
  },
  {
    files: ['core/**/*.ts', 'convex/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['convex/model/agents/**'],
    plugins: {gateway: {rules: {'sdk-location': {meta: {type: 'problem', schema: []}, create(context) {
      const check = node => {
        if (/^@anthropic-ai\/sdk(?:\/|$)/.test(node.source?.value ?? '')) context.report({node, message: 'L6: Anthropic SDK only under convex/model/agents/.'});
      };
      return {ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check, CallExpression(node) { if (node.callee.name === 'require') check({...node, source: node.arguments[0]}); }};
    }}}}},
    rules: {'gateway/sdk-location': 'error'},
  },
  {
    files: ['convex/**/*.ts'],
    ignores: ['**/*.test.ts', 'convex/_generated/**'],
    plugins: {'test-deps': {rules: {imports: {meta: {type: 'problem', schema: []}, create(context) {
      const check = node => {
        if (/^(?:vitest|convex-test|@edge-runtime)(?:\/|$)/.test(node.source?.value ?? '')) {
          context.report({node, message: 'Test dependencies belong outside the Convex functions directory.'});
        }
      };
      return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
        ImportExpression: check,
        TSImportType: check,
        CallExpression(node) { if (node.callee.name === 'require') check({...node, source: node.arguments[0]}); },
      };
    }}}}},
    rules: {'test-deps/imports': 'error'},
  },
  {
    files: ['convex/**/*.ts', 'core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    plugins: {'isolate': {rules: {'static-imports': {
      meta: {type: 'problem', schema: []},
      create(context) {
        return {ImportExpression(node) {
          context.report({node, message: 'Convex runtime forbids dynamic import(); use static imports and acyclic dependencies.'});
        }};
      },
    }}}},
    rules: {'isolate/static-imports': 'error'},
  },
  globalIgnores(["dist/**", ".task-tmp/**", ".sites-runtime/**", "docs/**", "lab/**", ".npm-cache/**", ".pnpm-store/**", ".next/**", "convex/_generated/**", "next-env.d.ts", "coverage/**"]),
  {
    files: ["core/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", "Date", "Intl", "fetch", "crypto", "process", "console"],
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "Pass deterministic inputs into core." }, { object: "globalThis", property: "Date" }, { object: "globalThis", property: "Intl" }, { object: "globalThis", property: "fetch" }],
      "no-restricted-imports": ["error", {
        patterns: [
          ...frameworkImports,
          { group: ["convex", "convex/*", "@convex/*", "@/*", "zod", "zod/*", "node:*"], message: "core/ must not depend on Convex or the Next app." },
          { regex: "^\\.{1,2}/.*(convex|src)/", message: "core/ must not reach into convex/ or src/." },
        ],
      }],
    },
  },
  {
    files: ["core/engine/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "ImportDeclaration[source.value=/scenarios/]",
        message: "The engine must not depend on scenario implementations.",
      }, {
        selector: "ExportNamedDeclaration[source.value=/scenarios/]",
        message: "The engine must not re-export scenario implementations.",
      }],
    },
  },
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts", "convex/_generated/**", "**/*.test.ts", "**/*.fixture.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: backendPatterns,
      }],
    },
  },
  {
    files: ['convex/model/views/**/*.ts'],
    rules: {'no-restricted-imports': ['error', {patterns: [
      ...backendPatterns,
      {regex: '(?:^|/)opsLog(?:[.][cm]?[jt]s)?$', importNames: ['opsLog'], message: 'Views may import only publicOpsLog.'},
    ]}]},
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            regex: "^@convex/(?!_generated/(api|dataModel)$)",
            message: "src/ may import only @convex/_generated/api and dataModel.",
          },
          { regex: "^\\.{1,2}/.*convex/", message: "Use the @convex/_generated alias, not relative paths." },
        ],
      }],
    },
  },
  // --- W2-6 BEGIN ---
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      ...(nextVitals[0]?.plugins?.["jsx-a11y"]?.flatConfigs?.recommended?.rules ?? {}),
      "no-restricted-syntax": "off",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@convex/(?!_generated/(api|dataModel)$)",
              message: "src/ may import only @convex/_generated/api and dataModel.",
            },
            {
              regex: "^\\.{1,2}/.*convex/",
              message: "Use the @convex/_generated alias, not relative paths.",
            },
            {
              regex: "^@core/(?!engine/ui$)",
              message: "src/ may import only @core/engine/ui (11 §11.4, L10).",
            },
            {
              regex: "^\\.{1,2}/.*core/",
              message: "Use @core/engine/ui, not relative paths into core/.",
            },
          ],
        },
      ],
    },
  },
  // --- W2-6 END ---
  // W2-1: independent rule avoids overriding another lane's restricted rules.
  {
    files: ['convex/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.fixture.ts', 'convex/_generated/**'],
    plugins: {w21: {rules: {platform: {
      create(context) {
        const filename = context.filename.replaceAll('\\', '/');
        const facade = filename.endsWith('/convex/lib/db.ts');
        const constructors = filename.endsWith('/convex/lib/functions.ts');
        const clock = filename.endsWith('/convex/lib/time.ts');
        // W2-GW gateway: wall-clock deadline measurement in the transport layer is the documented L8 exemption (10 §10.15).
        const legacyGateway = filename.endsWith('/convex/model/agents/modelGateway.ts');
        const report = (node, message) => context.report({node, message});
        return {
          ImportDeclaration(node) {
            if (!constructors && /(?:^|\/)_generated\/server(?:\.[jt]s)?$/.test(node.source.value)) {
              for (const spec of node.specifiers) if (['query', 'mutation', 'action', 'internalQuery', 'internalMutation', 'internalAction', 'httpAction'].includes(spec.imported?.name)) report(spec, 'Use audited constructors (L5).');
            }
          },
          MemberExpression(node) {
            const property = node.computed ? node.property.value : node.property.name;
            if (!facade && ['patch', 'replace', 'delete'].includes(property) && (node.object.name === 'db' || node.object.property?.name === 'db')) report(node, 'Use the write facade (L8).');
            if (!clock && !legacyGateway && property === 'now' && (node.object.name === 'Date' || node.object.property?.name === 'Date')) report(node, 'Use nowMs(ctx) (L8).');
          },
          SpreadElement(node) {
            if (filename.includes('/convex/model/views/')) report(node, 'Construct public DTOs field by field (L9).');
          },
        };
      },
    }}}},
    rules: {'w21/platform': 'error'},
  },
  // End W2-1.
]);
