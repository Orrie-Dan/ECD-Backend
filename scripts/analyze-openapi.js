const doc = require('../openapi.generated.json');
const schemas = doc.components.schemas;
const paths = doc.paths;

const enums = [];
for (const [n, s] of Object.entries(schemas)) {
  if (s.enum) enums.push({ name: n, values: s.enum, type: s.type });
  for (const [pk, p] of Object.entries(s.properties || {})) {
    if (p.enum && !p.$ref) {
      enums.push({ name: `${n}.${pk}`, values: p.enum, type: p.type, inline: true });
    }
  }
}
console.log('=== ENUMS ===');
console.log(JSON.stringify(enums, null, 2));

console.log('\n=== SECURITY ===');
console.log(JSON.stringify(doc.components.securitySchemes, null, 2));
const withoutSec = [];
let withSec = 0;
for (const [p, item] of Object.entries(paths)) {
  for (const m of Object.keys(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
    const op = item[m];
    const has = (op.security || []).some((s) => Object.prototype.hasOwnProperty.call(s, 'bearer'));
    if (has) withSec++;
    else withoutSec.push(`${m.toUpperCase()} ${p}`);
  }
}
console.log({ withSec, withoutSec });

const headers = [];
for (const [p, item] of Object.entries(paths)) {
  for (const m of Object.keys(item)) {
    const op = item[m];
    for (const param of op.parameters || []) {
      if (param.in === 'header') {
        headers.push({
          name: param.name,
          required: !!param.required,
          op: `${m.toUpperCase()} ${p}`,
          schema: param.schema,
          example: param.example,
        });
      }
    }
  }
}
console.log('\n=== HEADERS ===');
console.log(JSON.stringify(headers, null, 2));

let with401 = 0,
  with403 = 0,
  with400 = 0,
  with404 = 0,
  with409 = 0,
  total = 0;
const missingAuthErrors = [];
for (const [p, item] of Object.entries(paths)) {
  for (const m of Object.keys(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
    total++;
    const r = item[m].responses || {};
    if (r['400']) with400++;
    if (r['401']) with401++;
    if (r['403']) with403++;
    if (r['404']) with404++;
    if (r['409']) with409++;
    const hasBearer = (item[m].security || []).some((s) =>
      Object.prototype.hasOwnProperty.call(s, 'bearer'),
    );
    if (hasBearer && (!r['401'] || !r['403'])) {
      missingAuthErrors.push(`${m.toUpperCase()} ${p}`);
    }
  }
}
console.log('\n=== ERROR COVERAGE ===', {
  total,
  with400,
  with401,
  with403,
  with404,
  with409,
  missingAuthErrorsCount: missingAuthErrors.length,
  missingAuthErrorsSample: missingAuthErrors.slice(0, 20),
});

console.log('\n=== AUTH vs USER ===');
console.log('AuthUser', Object.keys(schemas.AuthUserResponseDto?.properties || {}));
console.log('AuthMe', Object.keys(schemas.AuthMeResponseDto?.properties || {}));
console.log('User', Object.keys(schemas.UserResponseDto?.properties || {}));

console.log('\n=== PAGINATION-LIKE ===');
for (const n of Object.keys(schemas).sort()) {
  const p = schemas[n].properties || {};
  if (p.items || p.data || p.page || p.totalPages || p.hasMore || p.nextCursor) {
    console.log(n, Object.keys(p).join(','));
  }
}

console.log('\n=== EXAMPLE TYPE MISMATCHES ===');
let mismatches = 0;
for (const [n, s] of Object.entries(schemas)) {
  for (const [pk, prop] of Object.entries(s.properties || {})) {
    if (prop.example === undefined) continue;
    const ex = prop.example;
    if (prop.type === 'string' && typeof ex !== 'string' && ex !== null) {
      console.log(`${n}.${pk} expected string got ${typeof ex}`, ex);
      mismatches++;
    }
    if ((prop.type === 'integer' || prop.type === 'number') && typeof ex !== 'number') {
      console.log(`${n}.${pk} expected number got ${typeof ex}`, ex);
      mismatches++;
    }
    if (prop.type === 'boolean' && typeof ex !== 'boolean') {
      console.log(`${n}.${pk} expected bool got ${typeof ex}`, ex);
      mismatches++;
    }
    if (prop.type === 'array' && !Array.isArray(ex)) {
      console.log(`${n}.${pk} expected array`, ex);
      mismatches++;
    }
  }
}
console.log('mismatchCount', mismatches);

console.log('\n=== SCHEMAS WITHOUT required ===');
let noReq = 0;
const noReqNames = [];
for (const [n, s] of Object.entries(schemas)) {
  if (s.type === 'object' && s.properties && Object.keys(s.properties).length > 0 && !s.required) {
    noReq++;
    noReqNames.push(n);
  }
}
console.log({ noReq, sample: noReqNames.slice(0, 25) });

// Child status inline enum without enumName
console.log('\n=== INLINE STATUS ENUMS (no component) ===');
for (const [n, s] of Object.entries(schemas)) {
  for (const [pk, prop] of Object.entries(s.properties || {})) {
    if (prop.enum && !prop.$ref) {
      console.log(`${n}.${pk}`, prop.enum);
    }
  }
}

// Check servers / bearer scheme detail
console.log('\n=== INFO / SERVERS ===');
console.log({ info: doc.info, servers: doc.servers, tags: (doc.tags || []).map((t) => t.name) });

// Duplicate model smell: CenterResponseDto vs CenterDetailResponseDto vs CenterInDistrictResponseDto
function propSet(name) {
  return new Set(Object.keys(schemas[name]?.properties || {}));
}
function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}
const candidates = [
  ['AuthUserResponseDto', 'AuthMeResponseDto'],
  ['AuthUserResponseDto', 'UserResponseDto'],
  ['AuthCenterSummaryDto', 'UserCenterSummaryDto'],
  ['CenterResponseDto', 'CenterDetailResponseDto'],
  ['CenterResponseDto', 'CenterInDistrictResponseDto'],
  ['ChildResponseDto', 'ChildDetailResponseDto'],
  ['FollowUpCategory', 'FollowUpAlertCategory'],
];
console.log('\n=== NEAR-DUPLICATE SCHEMAS ===');
for (const [a, b] of candidates) {
  if (!schemas[a] || !schemas[b]) {
    console.log(a, b, 'missing');
    continue;
  }
  if (schemas[a].enum && schemas[b].enum) {
    console.log(a, b, 'enums', schemas[a].enum, schemas[b].enum);
    continue;
  }
  const A = propSet(a);
  const B = propSet(b);
  console.log(a, b, 'jaccard=', jaccard(A, B).toFixed(2), 'onlyA', [...A].filter((x) => !B.has(x)), 'onlyB', [...B].filter((x) => !A.has(x)));
}

// Operation request bodies without schema
console.log('\n=== REQUEST BODIES WITHOUT SCHEMA ===');
for (const [p, item] of Object.entries(paths)) {
  for (const m of Object.keys(item)) {
    const rb = item[m].requestBody;
    if (!rb) continue;
    const schema = rb.content?.['application/json']?.schema;
    if (!schema) console.log(`${m.toUpperCase()} ${p}`);
  }
}

// Query params named limit (deprecated?)
console.log('\n=== LIMIT vs PAGESIZE QUERY PARAMS ===');
for (const [p, item] of Object.entries(paths)) {
  for (const m of Object.keys(item)) {
    for (const param of item[m].parameters || []) {
      if (param.in === 'query' && (param.name === 'limit' || param.name === 'pageSize')) {
        console.log(`${m.toUpperCase()} ${p} ${param.name} required=${param.required}`);
      }
    }
  }
}

// Check ErrorResponseDto / ConflictResponseDto usage
let errRefs = 0;
let conflictRefs = 0;
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (node.$ref === '#/components/schemas/ErrorResponseDto') errRefs++;
  if (node.$ref === '#/components/schemas/ConflictResponseDto') conflictRefs++;
  for (const v of Object.values(node)) walk(v);
};
walk(paths);
console.log('\n=== ERROR SCHEMA REFS ===', { errRefs, conflictRefs });

// Settings list response?
console.log('\n=== SETTINGS / STANDARDS RESPONSE TYPES ===');
for (const p of ['/api/v1/settings', '/api/v1/compliance/standards', '/api/v1/admin-units']) {
  const item = paths[p];
  if (!item) continue;
  for (const m of Object.keys(item)) {
    const ok = item[m].responses?.['200'];
    console.log(m.toUpperCase(), p, JSON.stringify(ok?.content?.['application/json']?.schema || ok));
  }
}
