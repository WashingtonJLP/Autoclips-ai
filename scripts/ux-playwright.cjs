const fs = require('node:fs');
const assert = require('node:assert/strict');
// Integração local explícita: cria cortes e testa exclusões reversíveis.
assert.equal(
  process.env.UX_TEST_AUTHORIZED,
  'true',
  'Defina UX_TEST_AUTHORIZED=true para executar o teste local autorizado.',
);
const {
  chromium,
} = require('../artifacts/playwright-runtime/node_modules/playwright');
const base = 'http://localhost:3100';
const output = 'artifacts/ux-playwright.json';
const evidence = {
  startedAt: new Date().toISOString(),
  checks: [],
  productions: [],
  pageErrors: [],
  responses: [],
};
let browser, context;
async function check(name, fn) {
  const value = await fn();
  evidence.checks.push({ name, passed: true, value });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: name, value }));
  return value;
}
async function library() {
  return (await context.request.get(base + '/api/backend/library')).json();
}
async function metrics(page) {
  const content = await library();
  const expected = {
    clips: content.clips.filter((t) => !t.testContent).length,
    productions: content.productions.filter((p) => !p.testContent).length,
  };
  await page.waitForFunction(
    ({ clips, productions }) => {
      const cards = [...document.querySelectorAll('.metric')];
      const count = (label) =>
        cards.find((c) => c.innerText.includes(label))?.querySelector('strong')
          ?.textContent;
      return (
        count('Cortes prontos') === String(clips) &&
        count('Produções') === String(productions)
      );
    },
    expected,
    { timeout: 15000 },
  );
  return expected;
}
async function setup(page, burn, count = '2') {
  await page.goto(base + '/criar');
  await page
    .locator('input[name=url]')
    .fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.locator('input[name=maxClips]').fill(count);
  await page.locator('select[name=maxDuration]').selectOption('30');
  await page.locator('select[name=language]').selectOption('auto');
  await page.locator('select[name=burnSubtitles]').selectOption(String(burn));
}
async function start(page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/backend/productions') &&
      r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Gerar cortes', exact: true }).click();
  const res = await response;
  const root = await res.json();
  assert.equal(res.status(), 201, JSON.stringify(root));
  evidence.productions.push(root.id);
  console.log(JSON.stringify({ started: root.id, status: root.status }));
  return root;
}
async function complete(page, id) {
  await page.waitForURL(new RegExp('producao=' + id));
  await page.waitForFunction(
    () =>
      document.querySelector('aside.panel > p[role=status]')?.textContent ===
      'Conclu\u00eddo',
    null,
    { timeout: 900000 },
  );
  const p = (await library()).productions.find((p) => p.id === id);
  assert.equal(p.status, 'COMPLETED', JSON.stringify(p));
  assert.ok(p.clips.length > 0);
  return p;
}
async function play(page, id, label) {
  await page.goto(base + '/biblioteca?video=' + id);
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const video = dialog.locator('video');
  await video.evaluate(async (v) => {
    v.muted = true;
    await v.play();
  });
  await page.waitForFunction(
    () => {
      const v = document.querySelector('dialog video');
      return (
        v &&
        !v.error &&
        v.currentTime > 2 &&
        v.videoWidth === 720 &&
        v.videoHeight === 1280
      );
    },
    null,
    { timeout: 60000 },
  );
  const playback = await video.evaluate((v) => ({
    width: v.videoWidth,
    height: v.videoHeight,
    time: v.currentTime,
    decoded: v.getVideoPlaybackQuality().totalVideoFrames,
  }));
  assert.ok(playback.decoded > 0);
  await page.screenshot({
    path: 'artifacts/ux-' + label + '-playback.png',
    fullPage: true,
  });
  for (const [text, extension] of [
    ['Baixar MP4', 'mp4'],
    ['Baixar SRT', 'srt'],
  ]) {
    const wait = page.waitForEvent('download');
    await dialog.getByRole('link', { name: text, exact: true }).click();
    const download = await wait;
    await download.saveAs('artifacts/ux-' + label + '.' + extension);
    assert.ok(fs.statSync('artifacts/ux-' + label + '.' + extension).size > 50);
  }
  assert.match(
    fs.readFileSync('artifacts/ux-' + label + '.srt', 'utf8'),
    /\d\d:\d\d:\d\d,\d\d\d -->/,
  );
  return playback;
}
async function main() {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    httpCredentials: {
      username: process.env.DASHBOARD_USER,
      password: process.env.DASHBOARD_PASSWORD,
      origin: base,
    },
  });
  context.on('page', (p) => {
    p.on('pageerror', (e) => evidence.pageErrors.push(e.message));
    p.on('response', (r) => {
      if (
        r.url().includes('/api/backend/productions') &&
        r.request().method() === 'POST'
      )
        evidence.responses.push({
          path: new URL(r.url()).pathname,
          status: r.status(),
        });
    });
  });
  const p1 = await context.newPage(),
    p2 = await context.newPage();
  await setup(p1, true);
  await setup(p2, true);
  await check('Botao unico e ausencia de autorizacao', async () => {
    assert.equal(
      await p1
        .getByRole('button', { name: 'Gerar cortes', exact: true })
        .count(),
      1,
    );
    assert.equal(
      await p1
        .getByText(/Tenho autoriza|Voc\u00ea pode usar este v\u00eddeo/)
        .count(),
      0,
    );
    await p1.screenshot({
      path: 'artifacts/ux-create-desktop.png',
      fullPage: true,
    });
    return true;
  });
  const root = await check(
    'Cliques rapidos e duas abas reutilizam producao',
    async () => {
      const waits = [p1, p2].map((p) =>
        p.waitForResponse(
          (r) =>
            r.url().endsWith('/api/backend/productions') &&
            r.request().method() === 'POST',
        ),
      );
      await Promise.all([
        p1
          .getByRole('button', { name: 'Gerar cortes', exact: true })
          .evaluate((b) => {
            b.click();
            b.click();
            b.click();
          }),
        p2.getByRole('button', { name: 'Gerar cortes', exact: true }).click(),
      ]);
      const roots = await Promise.all(
        (await Promise.all(waits)).map((r) => r.json()),
      );
      assert.equal(roots[0].id, roots[1].id, JSON.stringify(roots));
      evidence.productions.push(roots[0].id);
      assert.equal(
        evidence.responses.filter((r) => r.path.endsWith('/productions'))
          .length,
        2,
      );
      return roots[0];
    },
  );
  await check('Atualizacao preserva acompanhamento', async () => {
    await p1.waitForURL(new RegExp('producao=' + root.id));
    await p1.reload();
    await p1
      .locator('aside.panel')
      .getByRole('heading', { level: 3 })
      .waitFor();
    assert.ok(p1.url().includes(root.id));
    return await p1.locator('aside.panel').innerText();
  });
  const on = await check('Conclusao automatica com legendas', () =>
    complete(p1, root.id),
  );
  await check('Reproducao MP4 e download SRT com legendas', () =>
    play(p1, on.clips[0].id, 'captions-on'),
  );
  await setup(p2, false);
  const offroot = await start(p2);
  assert.notEqual(offroot.id, root.id);
  const off = await check(
    'Configuracao diferente gera nova producao sem legendas',
    () => complete(p2, offroot.id),
  );
  await check('Reproducao MP4 e download SRT sem legendas', () =>
    play(p2, off.clips[0].id, 'captions-off'),
  );
  await check('Preferencia de legendas persiste', async () => {
    await p2.goto(base + '/criar');
    assert.equal(
      await p2.locator('select[name=burnSubtitles]').inputValue(),
      'false',
    );
    return true;
  });
  await check('Responsividade sem rolagem horizontal', async () => {
    await p2.setViewportSize({ width: 390, height: 844 });
    await p2.waitForFunction(
      () =>
        document.querySelector('#sidebar').getBoundingClientRect().right <= 1,
    );
    await p2.screenshot({
      path: 'artifacts/ux-create-mobile.png',
      fullPage: true,
    });
    const dim = await p2.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(dim.scroll <= dim.width, JSON.stringify(dim));
    await p2.setViewportSize({ width: 1440, height: 1000 });
    return dim;
  });
  await p2.goto(base + '/criar?producao=' + on.id);
  const overview = await context.newPage();
  await overview.goto(base);
  await metrics(overview);
  await check('Excluir corte preserva irmaos e desfazer restaura', async () => {
    await p1.goto(base + '/biblioteca?video=' + on.clips[0].id);
    await p1
      .getByRole('dialog')
      .getByRole('button', { name: 'Excluir corte', exact: true })
      .click();
    await p1
      .getByRole('button', { name: 'Confirmar exclus\u00e3o', exact: true })
      .click();
    await p1
      .getByRole('button', { name: 'Desfazer exclus\u00e3o', exact: true })
      .waitFor();
    let current = (await library()).productions.find((p) => p.id === on.id);
    assert.equal(current.clips.length, on.clips.length - 1);
    await metrics(overview);
    await p2.waitForFunction(
      (n) =>
        document
          .querySelector('aside.panel')
          ?.innerText.includes(n + ' corte(s) dispon'),
      on.clips.length - 1,
      { timeout: 15000 },
    );
    await p1
      .getByRole('button', { name: 'Desfazer exclus\u00e3o', exact: true })
      .click();
    await metrics(overview);
    await p2.waitForFunction(
      (n) =>
        document
          .querySelector('aside.panel')
          ?.innerText.includes(n + ' corte(s) dispon'),
      on.clips.length,
      { timeout: 15000 },
    );
    return {
      before: on.clips.length,
      afterDelete: current.clips.length,
      restored: true,
    };
  });
  await check('Excluir producao sincroniza tarefas e desfazer', async () => {
    await p1.goto(base + '/biblioteca');
    const article = p1
      .locator('article.panel')
      .filter({ has: p1.locator('a[href="/criar?producao=' + off.id + '"]') });
    await article
      .getByRole('button', { name: 'Excluir produ\u00e7\u00e3o', exact: true })
      .click();
    await p1
      .getByRole('button', { name: 'Confirmar exclus\u00e3o', exact: true })
      .click();
    await p1
      .getByRole('button', { name: 'Desfazer exclus\u00e3o', exact: true })
      .waitFor();
    assert.ok(!(await library()).productions.some((p) => p.id === off.id));
    await metrics(overview);
    await p2.waitForFunction(
      (id) =>
        !document.querySelector(
          'section[aria-label="Tarefas recentes"] a[href="/criar?producao=' +
            id +
            '"]',
        ),
      off.id,
      { timeout: 15000 },
    );
    await p1
      .getByRole('button', { name: 'Desfazer exclus\u00e3o', exact: true })
      .click();
    await p1.locator('a[href="/criar?producao=' + off.id + '"]').waitFor();
    assert.ok((await library()).productions.some((p) => p.id === off.id));
    await metrics(overview);
    return { removed: true, restored: true };
  });
  await check(
    'Video existente reutiliza a producao correspondente',
    async () => {
      await setup(p1, true);
      await p1
        .getByRole('button', {
          name: 'Escolher v\u00eddeo existente',
          exact: true,
        })
        .click();
      await p1
        .getByRole('combobox', { name: /^V\u00eddeo existente/ })
        .selectOption(on.assetId);
      const existing = await start(p1);
      assert.equal(existing.id, on.id);
      return existing.id;
    },
  );
  await check('Nenhum trecho elegivel nao aparece como sucesso', async () => {
    await setup(p1, true);
    await p1.locator('details.advanced > summary').first().click();
    await p1
      .getByText('Critérios da seleção e fallback', { exact: true })
      .click();
    await p1.locator('input[name=minScore]').fill('10');
    const empty = await start(p1);
    await p1.waitForFunction(
      () =>
        document.querySelector('aside.panel > p[role=status]')?.textContent ===
        'Nenhum trecho elegível',
      null,
      { timeout: 900000 },
    );
    const item = (await library()).productions.find((p) => p.id === empty.id);
    assert.equal(item.status, 'EMPTY');
    assert.equal(item.clips.length, 0);
    await p1.screenshot({ path: 'artifacts/ux-empty.png', fullPage: true });
    return { id: item.id, status: item.status, clips: item.clips.length };
  });
  assert.deepEqual(evidence.pageErrors, []);
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
}
main()
  .catch((e) => {
    evidence.error = e.stack;
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => browser?.close());
