import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../content/content.js", import.meta.url), "utf8");

test("badge details close on outside click and Escape", () => {
  assert.match(source, /document\.addEventListener\("click", \(\) => closeOpenDetails\(\)\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /closeOpenDetails\(true\)/);
});

test("badge and dialog clicks do not count as outside clicks", () => {
  assert.match(source, /button\.addEventListener\("click", \(event\) => \{/);
  assert.match(source, /detail\.addEventListener\("click", \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(source, /aria-haspopup", "dialog/);
  assert.match(source, /detail\.setAttribute\("role", "dialog"\)/);
});

test("non-generated badge details render the local model score", () => {
  assert.match(source, /presentation\.localScore/);
  assert.match(source, /ローカルモデルスコア：/);
});

test("badge details are built with text nodes instead of innerHTML", () => {
  assert.doesNotMatch(source, /detail\.innerHTML/);
  assert.match(source, /detailHeading\.textContent = heading/);
  assert.match(source, /appendDetailParagraph\(detail, reason\)/);
});

test("every badge detail shows a non-definitive-use disclaimer", () => {
  assert.match(source, /本判定は参考情報です/);
  assert.match(source, /画像の真贋、著作権、制作者や掲載者への評価を確定するものではありません/);
  assert.match(source, /result\.analysis\?\.contextAdvisories/);
});
