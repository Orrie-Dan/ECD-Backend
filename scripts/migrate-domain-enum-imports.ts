/**
 * One-off: move removed Prisma enum imports to src/common/domain.
 * Run: npx ts-node scripts/migrate-domain-enum-imports.ts
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { relative, resolve, dirname, sep, join } from 'path';

const ROOT = resolve(__dirname, '..');

const DOMAIN_ENUMS = new Set([
  'EcdCenterStatus',
  'UserRole',
  'UserAccountStatus',
  'ChildGender',
  'ChildStatus',
  'AttendanceStatus',
  'AbsentReason',
  'NutritionStatus',
  'TransferStatus',
  'StedAgeBand',
  'AssessmentType',
  'AssessmentStatus',
  'ItemResponse',
  'GapSeverity',
  'GapStatus',
  'StandardDomain',
  'DeviceStatus',
  'SyncSessionStatus',
  'AdministrativeLevel',
  'ClassroomGrade',
  'ClassroomAssignmentReason',
  'PersonSex',
  'EducationLevel',
  'ParentContributionType',
  'InKindItemType',
  'CenterSupportCategory',
]);

const PRISMA_IMPORT_RE =
  /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]@prisma\/client['"];?\s*\n/g;

function domainImportPath(filePath: string): string {
  const fromDir = dirname(filePath);
  const toDomain = resolve(ROOT, 'src/common/domain');
  let rel = relative(fromDir, toDomain).split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function splitImports(specifiers: string): { domain: string[]; prisma: string[] } {
  const parts = specifiers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const domain: string[] = [];
  const prisma: string[] = [];
  for (const part of parts) {
    const name = part.replace(/^type\s+/, '').trim();
    if (DOMAIN_ENUMS.has(name)) {
      domain.push(part);
    } else {
      prisma.push(part);
    }
  }
  return { domain, prisma };
}

function processFile(filePath: string): boolean {
  let content = readFileSync(filePath, 'utf8');
  let changed = false;
  const allDomain: string[] = [];

  content = content.replace(PRISMA_IMPORT_RE, (match, typePrefix, specifiers) => {
    const { domain, prisma } = splitImports(specifiers);
    if (domain.length === 0) {
      return match;
    }
    changed = true;
    allDomain.push(...domain);
    if (prisma.length === 0) {
      return '';
    }
    const prefix = typePrefix ?? '';
    return `import ${prefix}{ ${prisma.join(', ')} } from '@prisma/client';\n`;
  });

  if (!changed) {
    return false;
  }

  const uniqueDomain = [...new Set(allDomain)];
  const domainPath = domainImportPath(filePath);
  const domainImport = `import { ${uniqueDomain.join(', ')} } from '${domainPath}';\n`;

  const firstImport = content.search(/^import\s/m);
  if (firstImport >= 0) {
    content = content.slice(0, firstImport) + domainImport + content.slice(firstImport);
  } else {
    content = domainImport + content;
  }

  writeFileSync(filePath, content, 'utf8');
  return true;
}

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

const files: string[] = [];
collectTsFiles(resolve(ROOT, 'src'), files);
collectTsFiles(resolve(ROOT, 'scripts'), files);
files.filter((f) => !f.endsWith('migrate-domain-enum-imports.ts'));

let count = 0;
for (const file of files) {
  if (processFile(file)) {
    count++;
    console.log('updated:', relative(ROOT, file));
  }
}

// seed.ts uses raw SQL casts — update enum casts to plain strings
const seedPath = resolve(ROOT, 'prisma/seed.ts');
let seed = readFileSync(seedPath, 'utf8');
const seedBefore = seed;
seed = seed.replace(/'::public\.user_role/g, "'");
seed = seed.replace(/'::public\.user_account_status/g, "'");
if (seed !== seedBefore) {
  writeFileSync(seedPath, seed, 'utf8');
  console.log('updated: prisma/seed.ts');
  count++;
}

console.log(`\nDone. ${count} file(s) updated.`);
