// 开发小工具：校验 .github/ISSUE_TEMPLATE/*.yml 的基本结构。
// GitHub 对 issue 表单格式很挑，字段名写错会静默不显示表单。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// NB: use fileURLToPath, not url.pathname — pathname stays percent-encoded and
// this repository lives under a non-ASCII directory name.
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'ISSUE_TEMPLATE');
const files = readdirSync(dir).filter((f) => f.endsWith('.yml'));

for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  const problems = [];
  if (!/^name:/m.test(text)) problems.push('missing name');
  if (!/^description:/m.test(text)) problems.push('missing description');
  if (!/^body:/m.test(text)) problems.push('missing body');
  if (/\t/.test(text)) problems.push('contains TAB');

  // body 列表项（- type:）缩进 2 空格，其下字段缩进 4 空格，字段属性 6 空格
  const ids = [...text.matchAll(/^\s{4}id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const types = [...text.matchAll(/^\s{2}-\s+type:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const required = [...text.matchAll(/^\s{6}required:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const labels = [...text.matchAll(/^\s{6}label:\s*(.+)$/gm)].map((m) => m[1]);

  if (ids.length === 0) problems.push('no fields found (indentation?)');
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) problems.push(`duplicate ids: ${dup.join(', ')}`);
  for (const t of types) {
    if (t.startsWith('"')) problems.push(`type must not be quoted: ${t}`);
  }
  if (ids.length !== labels.length) problems.push(`field/label mismatch: ${ids.length} ids vs ${labels.length} labels`);

  const status = problems.length ? 'FAIL' : 'OK  ';
  process.stdout.write(`${status} ${f}: ${ids.length} fields (${types.join(', ')}, required: ${required.filter((r) => r === 'true').length})\n`);
  for (const p of problems) process.stdout.write(`       - ${p}\n`);
}
