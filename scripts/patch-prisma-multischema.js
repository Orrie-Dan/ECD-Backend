const fs = require('fs');
const path = 'prisma/schema.prisma';
let s = fs.readFileSync(path, 'utf8');

if (!s.includes('multiSchema')) {
  s = s.replace(
    'previewFeatures = ["postgresqlExtensions"]',
    'previewFeatures = ["postgresqlExtensions", "multiSchema"]',
  );
  s = s.replace(
    '  url        = env("DATABASE_URL")\n  extensions = [postgis(schema: "public")]',
    '  url        = env("DATABASE_URL")\n  schemas    = ["sde", "public"]\n  extensions = [postgis(schema: "public")]',
  );
}

s = s.replace(/(enum \w[\s\S]*?)(\n  @@map\()/g, (match, body, mapLine) => {
  if (body.includes('@@schema(')) return match;
  return body + '\n  @@schema("public")' + mapLine;
});

s = s.replace(/(model \w[\s\S]*?)(\n  @@map\()/g, (match, body, mapLine) => {
  if (body.includes('@@schema(')) return match;
  return body + '\n  @@schema("sde")' + mapLine;
});

fs.writeFileSync(path, s);
console.log('Patched schema.prisma for multiSchema (sde tables, public enums)');
