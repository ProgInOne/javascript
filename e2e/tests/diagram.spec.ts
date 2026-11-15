import { expect, test, type Page } from '@playwright/test';

// Lesson <Diagram> (D-050) and code display rules (ligatures off, inline code keeps spaces), in
// the production build under the app's CSP. The fixture lesson has no diagram, so the lesson
// response gets extra nodes here (content-cli would reject the broken one at build time).

const LESSON = '/learn/js-basics.start.first-program';
const OTHER_LESSON = '/learn/js-basics.values.variables';

const component = (name: string, props: Record<string, unknown>, ...children: unknown[]) => ({
  type: 'component',
  name,
  props,
  children,
});
const inlineCode = (value: string) => ({ type: 'inlineCode', value });
const paragraph = (...children: unknown[]) => ({ type: 'paragraph', children });

const FLOW = 'flowchart TD\n  A[첫 번째 문장] --> B[두 번째 문장]\n  B --> C[프로그램 끝]';
const WIDE = `flowchart LR\n  ${Array.from({ length: 12 }, (_, i) => `N${i}[아주 긴 단계 이름 ${i}]`).join(' --> ')}`;
const BROKEN = 'flowchart TD\n  A -->';
const SPACED = 'a  =  1;';
const LONG_TOKEN = `const ${'veryLongIdentifierName'.repeat(6)} = 1;`;

async function withExtraNodes(page: Page) {
  await page.route('**/api/v1/lessons/js-basics.start.first-program', async (route) => {
    const res = await route.fetch();
    const lesson = (await res.json()) as { body: unknown[] };
    lesson.body.push(
      component(
        'Section',
        { kind: 'examples', id: 'diagram-test' },
        component('Diagram', {
          alt: '문장이 위에서 아래로 실행되는 흐름',
          caption: '실행 순서',
          code: FLOW,
        }),
        component('Diagram', { alt: '열두 단계가 이어지는 넓은 흐름', code: WIDE }),
        component('Diagram', { alt: '그릴 수 없는 흐름', code: BROKEN }),
        paragraph(inlineCode('x => x !== y <!-- -->'), inlineCode(SPACED), inlineCode(LONG_TOKEN)),
      ),
    );
    await route.fulfill({ response: res, json: lesson });
  });
}

function watchCsp(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(msg.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test.describe('lesson diagram', () => {
  test('renders Mermaid as a labelled image under the app CSP, with a text alternative', async ({
    page,
  }) => {
    const problems = watchCsp(page);
    await withExtraNodes(page);
    await page.goto(LESSON);

    const flow = page.getByRole('img', { name: '문장이 위에서 아래로 실행되는 흐름' });
    await expect(flow).toHaveAttribute('aria-busy', 'false');
    await expect(flow.locator('svg')).toBeVisible();
    await expect(flow.locator('svg')).toContainText('두 번째 문장');
    // Strict mode with SVG text labels: no HTML inside the drawing, no script, no links.
    await expect(flow.locator('foreignObject, script, a')).toHaveCount(0);
    await expect(page.locator('figcaption', { hasText: '실행 순서' })).toBeVisible();

    const figure = page.locator('figure.lesson-diagram').first();
    await figure.getByText('다이어그램 소스 보기 (텍스트)').click();
    await expect(figure.locator('details code')).toHaveText(FLOW);

    // A source that does not parse falls back to a notice and the open source.
    const broken = page.locator('figure.lesson-diagram').nth(2);
    await expect(broken.getByRole('note')).toContainText('다이어그램을 그리지 못했어요.');
    await expect(broken.getByRole('note')).toContainText('그릴 수 없는 흐름');
    await expect(broken.locator('details')).toHaveAttribute('open', '');
    await expect(broken.locator('details code')).toHaveText(BROKEN);
    // Mermaid's own error drawing is not left in the page.
    await expect(page.locator('body > [id^="dpi-diagram-"]')).toHaveCount(0);

    expect(problems).toEqual([]);
  });

  test('follows the dark theme from the design tokens', async ({ page }) => {
    await withExtraNodes(page);
    await page.goto(LESSON);
    const flow = page.getByRole('img', { name: '문장이 위에서 아래로 실행되는 흐름' });
    await expect(flow.locator('svg')).toBeVisible();
    const labelFill = () =>
      flow.locator('svg').evaluate((svg) => {
        const text = svg.querySelector('.nodeLabel, text, tspan');
        return text ? getComputedStyle(text).fill : '';
      });
    const light = await labelFill();
    await page.evaluate(() => (document.documentElement.dataset['theme'] = 'dark'));
    await expect.poll(labelFill).not.toBe(light);
  });

  test('loads Mermaid only for a lesson that has a diagram', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script') scripts.push(req.url());
    });
    await page.goto(OTHER_LESSON);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The body is rendered (and its effects have run) once a section is on screen.
    await expect(page.locator('.lesson-section').first()).toBeVisible();
    expect(scripts.filter((u) => /mermaid/i.test(u))).toEqual([]);

    await withExtraNodes(page);
    await page.goto(LESSON);
    await expect(page.locator('figure.lesson-diagram svg').first()).toBeVisible();
    expect(scripts.some((u) => /mermaid/i.test(u))).toBe(true);
  });
});

test.describe('code display', () => {
  test('no ligatures in code, and inline code keeps its spaces', async ({ page }) => {
    await withExtraNodes(page);
    await page.goto(LESSON);
    const arrow = page.locator('code.lesson-inline-code', { hasText: 'x => x !== y' });
    await expect(arrow).toBeVisible();
    for (const target of [arrow, page.locator('pre.lesson-code').first()]) {
      const style = await target.evaluate((el) => {
        const s = getComputedStyle(el);
        return { ligatures: s.fontVariantLigatures, features: s.fontFeatureSettings };
      });
      expect(style.ligatures).toBe('none');
      expect(style.features).toMatch(/"liga" 0/);
      expect(style.features).toMatch(/"calt" 0/);
    }
    const spaced = page.locator('code.lesson-inline-code', { hasText: 'a  =  1;' });
    await expect(spaced).toHaveCSS('white-space', 'break-spaces');
    // Two spaces render wider than one: compare with the same text collapsed.
    const widths = await spaced.evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.textContent = 'a = 1;';
      el.after(copy);
      const result = {
        spaced: el.getBoundingClientRect().width,
        collapsed: copy.getBoundingClientRect().width,
      };
      copy.remove();
      return result;
    });
    expect(widths.spaced).toBeGreaterThan(widths.collapsed);

    // The editor in a runnable example has ligatures off too.
    const editor = page.locator('.cm-content').first();
    if (await editor.count()) {
      await expect(editor).toHaveCSS('font-variant-ligatures', 'none');
    }
  });

  test.describe('phone width (390px)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a long inline token and a wide diagram do not widen the page', async ({ page }) => {
      await withExtraNodes(page);
      await page.goto(LESSON);
      await expect(page.locator('code.lesson-inline-code', { hasText: 'veryLong' })).toBeVisible();
      await expect(
        page.getByRole('img', { name: '열두 단계가 이어지는 넓은 흐름' }).locator('svg'),
      ).toBeVisible();
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  });
});
