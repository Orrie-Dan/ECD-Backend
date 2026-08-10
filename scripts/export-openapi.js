/**
 * Bootstraps Nest (no HTTP listen), writes OpenAPI JSON, prints validation summary.
 * Usage: node scripts/export-openapi.js [outPath]
 */
const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require('../dist/app.module');

function collectRefs(node, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (typeof node.$ref === 'string') refs.add(node.$ref);
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else {
    for (const v of Object.values(node)) collectRefs(v, refs);
  }
  return refs;
}

function analyze(doc) {
  const schemas = doc.components?.schemas || {};
  const schemaNames = Object.keys(schemas);
  const paths = doc.paths || {};
  const pathKeys = Object.keys(paths);
  const issues = [];

  // Broken $refs
  const refs = collectRefs(doc);
  for (const ref of refs) {
    const m = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (m && !schemas[m[1]]) {
      issues.push({ severity: 'blocker', kind: 'invalid_ref', detail: ref });
    }
  }

  // Security schemes
  const securitySchemes = doc.components?.securitySchemes || {};
  if (!securitySchemes.bearer || !Object.keys(securitySchemes).length) {
    // Nest default name is 'bearer'
    if (!Object.keys(securitySchemes).length) {
      issues.push({
        severity: 'blocker',
        kind: 'auth',
        detail: 'No components.securitySchemes defined',
      });
    }
  }

  // Operations missing responses / schemas
  let opCount = 0;
  let opsMissingOkSchema = 0;
  let opsMissingSecurity = 0;
  let untypedObjectProps = 0;
  const untypedExamples = [];
  const emptySchemas = [];
  const duplicateTitles = new Map();

  for (const [p, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method))
        continue;
      const op = item[method];
      opCount++;
      const ok =
        op.responses?.['200'] ||
        op.responses?.['201'] ||
        op.responses?.['204'];
      if (!ok) {
        issues.push({
          severity: 'major',
          kind: 'missing_success_response',
          detail: `${method.toUpperCase()} ${p}`,
        });
      } else {
        const content = ok.content?.['application/json'];
        if (content && !content.schema) {
          opsMissingOkSchema++;
          issues.push({
            severity: 'major',
            kind: 'missing_response_schema',
            detail: `${method.toUpperCase()} ${p}`,
          });
        }
      }

      const hasBearer =
        (op.security && op.security.some((s) => Object.keys(s).includes('bearer'))) ||
        (doc.security && doc.security.some((s) => Object.keys(s).includes('bearer')));
      const isPublicAuth =
        p.includes('/auth/login') ||
        p.includes('/auth/refresh') ||
        p.includes('/auth/password-reset');
      if (!hasBearer && !isPublicAuth && method !== 'options') {
        opsMissingSecurity++;
      }
    }
  }

  // Schema quality
  const enumSchemas = [];
  const nullableProps = [];
  const requiredNullable = [];

  for (const [name, schema] of Object.entries(schemas)) {
    const props = schema.properties || {};
    const propKeys = Object.keys(props);
    if (schema.type === 'object' && propKeys.length === 0 && !schema.additionalProperties) {
      emptySchemas.push(name);
    }
    if (schema.enum) enumSchemas.push(name);
    if (schema.title) {
      const list = duplicateTitles.get(schema.title) || [];
      list.push(name);
      duplicateTitles.set(schema.title, list);
    }

    for (const [pk, prop] of Object.entries(props)) {
      // Untyped free-form objects
      if (
        prop.type === 'object' &&
        !prop.properties &&
        !prop.$ref &&
        !prop.allOf &&
        !prop.oneOf &&
        !prop.anyOf &&
        prop.additionalProperties === undefined
      ) {
        untypedObjectProps++;
        untypedExamples.push(`${name}.${pk}`);
      }
      if (
        prop.type === 'array' &&
        prop.items &&
        prop.items.type === 'object' &&
        !prop.items.properties &&
        !prop.items.$ref
      ) {
        untypedObjectProps++;
        untypedExamples.push(`${name}.${pk}[]`);
      }
      if (prop.nullable) nullableProps.push(`${name}.${pk}`);
      if (prop.nullable && Array.isArray(schema.required) && schema.required.includes(pk)) {
        // required + nullable is valid OpenAPI 3 but often surprises TS clients
        requiredNullable.push(`${name}.${pk}`);
      }
    }
  }

  // Pagination shape consistency
  const paginated = schemaNames.filter(
    (n) =>
      /Paginated|List.*Response|.*ListResponse/i.test(n) ||
      (schemas[n].properties?.items &&
        schemas[n].properties?.total &&
        schemas[n].properties?.page),
  );
  const paginationInconsistencies = [];
  for (const n of paginated) {
    const p = schemas[n].properties || {};
    for (const field of ['items', 'total', 'page', 'pageSize', 'totalPages']) {
      if (!p[field]) paginationInconsistencies.push(`${n} missing ${field}`);
    }
  }

  // Users dual data/items
  if (schemas.PaginatedUsersResponseDto?.properties) {
    const p = schemas.PaginatedUsersResponseDto.properties;
    if (p.data && p.items) {
      issues.push({
        severity: 'minor',
        kind: 'duplicate_fields',
        detail: 'PaginatedUsersResponseDto exposes both data and items',
      });
    }
  }

  return {
    openapi: doc.openapi,
    info: doc.info,
    pathCount: pathKeys.length,
    operationCount: opCount,
    schemaCount: schemaNames.length,
    securitySchemes: Object.keys(securitySchemes),
    enumSchemaCount: enumSchemas.length,
    enumSchemas,
    emptySchemas,
    untypedObjectProps,
    untypedExamples: untypedExamples.slice(0, 40),
    requiredNullableCount: requiredNullable.length,
    requiredNullable: requiredNullable.slice(0, 30),
    opsMissingOkSchema,
    opsMissingSecurity,
    paginationSchemas: paginated,
    paginationInconsistencies,
    issues,
    schemaNames: schemaNames.sort(),
    pathKeys: pathKeys.sort(),
  };
}

async function main() {
  const outPath = path.resolve(
    process.argv[2] || path.join(__dirname, '..', 'openapi.generated.json'),
  );

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('ECD Backend API')
    .setDescription(
      'Early Childhood Development management system API. ' +
        'Success responses are bare DTO bodies; errors use `{ success, statusCode, message, timestamp }` ' +
        '(plus `entity` / `currentVersion` on optimistic-lock conflicts). ' +
        'List endpoints use offset pagination (`items`, `page`, `pageSize`, `total`, `totalPages`); ' +
        'sync pull uses cursor pagination.',
    )
    .setVersion('1.0')
    .addServer('http://localhost:3000', 'Local development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from POST /api/v1/auth/login (`Authorization: Bearer <accessToken>`).',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf8');

  const report = analyze(document);
  const reportPath = outPath.replace(/\.json$/i, '.validation.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        reportPath,
        pathCount: report.pathCount,
        operationCount: report.operationCount,
        schemaCount: report.schemaCount,
        securitySchemes: report.securitySchemes,
        issueCount: report.issues.length,
        blockers: report.issues.filter((i) => i.severity === 'blocker').length,
        untypedObjectProps: report.untypedObjectProps,
        emptySchemas: report.emptySchemas.length,
        opsMissingSecurity: report.opsMissingSecurity,
      },
      null,
      2,
    ),
  );

  await app.close();
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
