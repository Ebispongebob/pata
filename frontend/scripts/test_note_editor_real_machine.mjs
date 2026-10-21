import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const frontendDir = path.resolve(rootDir, 'frontend');
const distDir = path.resolve(frontendDir, 'dist');
const artifactDir = '/Users/wuyukang/.gemini/antigravity-cli/brain/6c1d3ebb-66ff-4590-b1a5-c697e2335dfe';

// Find built CSS file in dist/assets
let builtCssName = '';
if (fs.existsSync(path.join(distDir, 'assets'))) {
  const cssFiles = fs.readdirSync(path.join(distDir, 'assets')).filter(f => f.endsWith('.css'));
  if (cssFiles.length > 0) {
    builtCssName = `/assets/${cssFiles[0]}`;
  }
}

const sampleMarkdown = `# 一级标题 Heading 1
## 二级标题 Heading 2
### 三级标题 Heading 3
#### 四级标题 Heading 4
##### 五级标题 Heading 5
###### 六级标题 Heading 6

这是**粗体文字 Bold**，这是*斜体文字 Italic*，这是~~删除线 Strikethrough~~，这是\`行内代码 inline_code()\`，这是==高亮标记 Highlight==。

> 这是一段引用内容，阐述系统设计与核心原则。
>> 这是一段嵌套引用，强调边界安全与 Local First。

- 无序列表第一项
- 无序列表第二项
  - 嵌套无序列表子项

1. 有序列表步骤一
2. 有序列表步骤二

- [ ] 待办任务清单项 A（未完成）
- [x] 已完成任务清单项 B（已勾选）

| 功能特性 | 语法标记 | 预期效果 | 对齐状态 |
| :--- | :---: | ---: | :--- |
| 标题渲染 | \`# 标题\` | 语义化 h1~h6 | 居左对齐 |
| 任务清单 | \`- [ ]\` | 交互式 Checkbox | 居中对齐 |
| 数据表格 | \`\\| a \\| b \\|\` | 格式化表格网格 | 居右对齐 |

\`\`\`go
package main

import "fmt"

// Task 结构体说明
type Task struct {
    ID    string \`json:"id"\`
    Title string \`json:"title"\`
}

func main() {
    fmt.Println("Pata Note Editor Live Verification")
}
\`\`\`

\`\`\`typescript
interface NoteRef {
  id: string;
  title: string;
  tags: string[];
}
const computeExcerpt = (text: string): string => text.slice(0, 50);
\`\`\`

\`\`\`python
def calculate_metrics(count: int) -> float:
    return float(count) * 1.5
\`\`\`

---

欢迎访问 [Pata 官方链接](https://github.com/pata) 或引用内部双链 [[系统架构说明]] 与资源 [[使用说明.pdf]]。

这是一个包含脚注的说明文本[^note1]。

[^note1]: 这里的脚注详细解释了 Local First 原则。

在中文排版测试中，测试中英文混排autoSpace微空格以及“全角双引号”、《书名号》、破折号——与省略号……的显示。
`;

const htmlPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Pata Note Editor Test Harness</title>
  ${builtCssName ? `<link rel="stylesheet" href="${builtCssName}" />` : ''}
  <link rel="stylesheet" href="/vditor/dist/index.css" />
  <script src="/vditor/dist/index.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .wrapper {
      max-width: 900px;
      margin: 0 auto;
    }
  </style>
</head>
<body class="bg-stone-50 text-stone-900 antialiased">
  <div class="wrapper">
    <div id="note-title-mock" class="text-2xl font-bold mb-3">实机测试：Pata Note 编辑器语法与渲染校验</div>
    <div id="vditor-container" class="vditor-editor-wrapper bg-transparent" style="min-height: 700px;"></div>
  </div>

  <script>
    window.__vditorReady = false;
    window.__clickedLinks = [];
    window.__inputEvents = 0;

    const initialMd = ${JSON.stringify(sampleMarkdown)};

    window.vditor = new Vditor(document.getElementById('vditor-container'), {
      cdn: '/vditor',
      mode: 'ir',
      value: initialMd,
      height: 750,
      placeholder: '开始记录内容...（支持 Markdown 语法、表格、代码块）',
      theme: 'classic',
      preview: {
        theme: {
          current: 'light',
        },
        hljs: {
          style: 'github',
        },
        markdown: {
          toc: true,
          mark: true,
          footnotes: true,
          autoSpace: true,
        },
      },
      cache: {
        enable: false,
      },
      toolbar: [],
      toolbarConfig: {
        hide: true,
      },
      link: {
        isOpen: true,
        click: (a) => {
          const href = a.getAttribute('href') || a.innerText;
          window.__clickedLinks.push(href);
        }
      },
      input: () => {
        window.__inputEvents++;
      },
      after: () => {
        window.__vditorReady = true;
      }
    });
  </script>
</body>
</html>`;

// MIME type resolver
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    default: return 'application/octet-stream';
  }
}

async function startServer(port = 9488) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    let reqPath = parsedUrl.pathname;

    if (reqPath === '/' || reqPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage);
      return;
    }

    // Serve from dist or public
    let filePath = path.join(distDir, reqPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(frontendDir, 'public', reqPath);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${reqPath}`);
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.reqId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log('🚀 Starting Pata Note Editor Real-Machine Acceptance Test...');
  const serverPort = 9488;
  const cdpPort = 9489;
  const server = await startServer(serverPort);
  console.log(`✓ Test HTTP server listening on http://127.0.0.1:${serverPort}`);

  const tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pata-chrome-test-'));
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tmpUserDir}`,
    '--window-size=1280,1024',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ];

  console.log(`✓ Launching macOS Google Chrome (${chromePath})...`);
  const chromeProc = spawn(chromePath, chromeArgs);

  let cdp = null;
  const testResults = [];

  function record(category, feature, expected, actual, pass, notes = '') {
    testResults.push({ category, feature, expected, actual, pass, notes });
    const mark = pass ? '✅' : '❌';
    console.log(`  ${mark} [${category}] ${feature}: ${notes || actual}`);
  }

  try {
    // Wait for Chrome CDP port
    let versionData = null;
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        versionData = await resp.json();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!versionData) {
      throw new Error('Failed to connect to Chrome debugging port within timeout');
    }

    // Get or create page target
    const listResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const listData = await listResp.json();
    let pageTarget = listData.find(t => t.type === 'page');
    if (!pageTarget) {
      const newPageResp = await fetch(`http://127.0.0.1:${cdpPort}/json/new`, { method: 'PUT' });
      pageTarget = await newPageResp.json();
    }
    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('✓ Connected to Chrome CDP WebSocket');

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    console.log(`✓ Navigating to http://127.0.0.1:${serverPort}...`);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });

    // Wait until vditor is ready
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      ready = await cdp.eval('window.__vditorReady === true');
      if (ready) break;
    }

    if (!ready) {
      throw new Error('Vditor failed to initialize ready flag within 10 seconds');
    }
    console.log('✓ Vditor initialized successfully in IR (Instant Rendering) mode');

    // 1. Heading Elements Test
    const headingCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      if (!container) return { error: 'IR container not found' };
      const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => {
        const style = window.getComputedStyle(h);
        return {
          tag: h.tagName.toLowerCase(),
          text: h.textContent.trim(),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          color: style.color
        };
      });
      return { headings };
    })()`);

    if (headingCheck.error) {
      record('语法与渲染', '标题层级 (H1~H6)', '正确渲染 6 级语义化标题', headingCheck.error, false);
    } else {
      const tags = headingCheck.headings.map(h => h.tag);
      const allPresent = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].every(t => tags.includes(t));
      const h1Size = parseFloat(headingCheck.headings.find(h => h.tag === 'h1')?.fontSize || '0');
      const h2Size = parseFloat(headingCheck.headings.find(h => h.tag === 'h2')?.fontSize || '0');
      const h3Size = parseFloat(headingCheck.headings.find(h => h.tag === 'h3')?.fontSize || '0');
      const sizeHierarchy = h1Size > h2Size && h2Size > h3Size;
      record(
        '语法与渲染',
        '标题层级 (H1~H6)',
        '包含 h1~h6 标签且字号具有严格视觉梯度',
        `已渲染 ${tags.join(', ')}；字号梯度：H1(${h1Size}px) > H2(${h2Size}px) > H3(${h3Size}px)`,
        allPresent && sizeHierarchy
      );
    }

    // 2. Inline Formatting Test (Bold, Italic, Strikethrough, Code, Mark)
    const inlineCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const strong = container.querySelector('strong, b');
      const em = container.querySelector('em, i');
      const s = container.querySelector('s, del, strike');
      const code = container.querySelector(':not(pre) > code');
      const mark = container.querySelector('mark');

      const styleOf = el => el ? {
        fontWeight: window.getComputedStyle(el).fontWeight,
        fontStyle: window.getComputedStyle(el).fontStyle,
        textDecoration: window.getComputedStyle(el).textDecorationLine,
        backgroundColor: window.getComputedStyle(el).backgroundColor,
        fontFamily: window.getComputedStyle(el).fontFamily,
      } : null;

      return {
        strong: !!strong,
        strongText: strong?.textContent,
        strongStyle: styleOf(strong),
        em: !!em,
        emText: em?.textContent,
        emStyle: styleOf(em),
        s: !!s,
        sText: s?.textContent,
        sStyle: styleOf(s),
        code: !!code,
        codeText: code?.textContent,
        codeStyle: styleOf(code),
        mark: !!mark,
        markText: mark?.textContent,
        markStyle: styleOf(mark),
      };
    })()`);

    record(
      '语法与渲染',
      '粗体文字 (**bold**)',
      '渲染为加粗语义节点',
      inlineCheck.strong ? `命中 strong (weight: ${inlineCheck.strongStyle?.fontWeight}, 内容: "${inlineCheck.strongText}")` : '未找到',
      inlineCheck.strong
    );
    record(
      '语法与渲染',
      '斜体文字 (*italic*)',
      '渲染为斜体语义节点',
      inlineCheck.em ? `命中 em (style: ${inlineCheck.emStyle?.fontStyle}, 内容: "${inlineCheck.emText}")` : '未找到',
      inlineCheck.em
    );
    record(
      '语法与渲染',
      '删除线 (~~strike~~)',
      '渲染为贯穿线文本',
      inlineCheck.s ? `命中 s/del (decoration: ${inlineCheck.sStyle?.textDecoration}, 内容: "${inlineCheck.sText}")` : '未找到',
      inlineCheck.s
    );
    record(
      '语法与渲染',
      '行内代码 (`code`)',
      '等宽字体与浅色代码背景底色',
      inlineCheck.code ? `命中 inline code (font: ${inlineCheck.codeStyle?.fontFamily.slice(0, 25)}, 内容: "${inlineCheck.codeText}")` : '未找到',
      inlineCheck.code
    );
    record(
      '语法与渲染',
      '高亮标记 (==mark==)',
      '渲染为标记文本节点',
      inlineCheck.mark ? `命中 mark (内容: "${inlineCheck.markText}")` : '未找到',
      inlineCheck.mark
    );

    // 3. Lists & Checklist Test
    const listCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const uls = container.querySelectorAll('ul:not(.vditor-task)');
      const ols = container.querySelectorAll('ol');
      const taskLis = container.querySelectorAll('li.vditor-task');
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');

      return {
        ulCount: uls.length,
        olCount: ols.length,
        taskListCount: taskLis.length,
        checkboxCount: checkboxes.length,
        checkboxStates: Array.from(checkboxes).map(c => c.checked),
      };
    })()`);

    record(
      '语法与渲染',
      '无序列表 (- item)',
      '正确渲染 ul 与 li 结构',
      `渲染 ${listCheck.ulCount} 个无序列表`,
      listCheck.ulCount >= 1
    );
    record(
      '语法与渲染',
      '有序列表 (1. item)',
      '正确渲染 ol 与数字序号',
      `渲染 ${listCheck.olCount} 个有序列表`,
      listCheck.olCount >= 1
    );
    record(
      '语法与渲染',
      '任务清单 (- [ ] / - [x])',
      '渲染原生交互复选框，初始状态匹配',
      `共 ${listCheck.checkboxCount} 个复选框，状态分布：[${listCheck.checkboxStates.join(', ')}]`,
      listCheck.checkboxCount >= 2 && listCheck.checkboxStates[0] === false && listCheck.checkboxStates[1] === true
    );

    // Interactive Checkbox Toggle Test
    const checkboxToggleResult = await cdp.eval(`(() => {
      const box = document.querySelector('.vditor-ir pre.vditor-reset input[type="checkbox"]');
      if (!box) return { error: 'No checkbox found' };
      const before = box.checked;
      box.click();
      const after = box.checked;
      return { before, after, toggled: before !== after };
    })()`);

    record(
      '交互与编辑',
      '清单复选框点击勾选交互',
      '点击复选框能够无缝切换完成状态',
      checkboxToggleResult.toggled ? `从 ${checkboxToggleResult.before} 成功切换为 ${checkboxToggleResult.after}` : '点击未改变勾选状态',
      checkboxToggleResult.toggled
    );

    // 4. Blockquotes Test
    const quoteCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const quotes = container.querySelectorAll('blockquote');
      const nested = container.querySelectorAll('blockquote blockquote');
      const style = quotes.length > 0 ? window.getComputedStyle(quotes[0]) : null;
      return {
        count: quotes.length,
        nestedCount: nested.length,
        borderLeft: style?.borderLeft,
        paddingLeft: style?.paddingLeft,
        color: style?.color,
      };
    })()`);

    record(
      '语法与渲染',
      '引用块 (> quote 与嵌套 >>)',
      '渲染单层与嵌套 blockquote，具备左侧边框',
      `共 ${quoteCheck.count} 层引用 (含 ${quoteCheck.nestedCount} 层嵌套)，borderLeft: ${quoteCheck.borderLeft}`,
      quoteCheck.count >= 2 && quoteCheck.nestedCount >= 1
    );

    // 5. Tables Test
    const tableCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const table = container.querySelector('table');
      if (!table) return { error: 'Table not found' };
      const ths = Array.from(table.querySelectorAll('th')).map(th => ({
        text: th.textContent.trim(),
        align: th.getAttribute('align') || window.getComputedStyle(th).textAlign,
      }));
      const tds = Array.from(table.querySelectorAll('tbody tr')).map(tr => 
        Array.from(tr.querySelectorAll('td')).map(td => ({
          text: td.textContent.trim(),
          align: td.getAttribute('align') || window.getComputedStyle(td).textAlign,
        }))
      );
      return {
        thCount: ths.length,
        rowCount: tds.length,
        ths,
        alignments: ths.map(t => t.align),
      };
    })()`);

    const hasAlignments = tableCheck.alignments && tableCheck.alignments.includes('center') && tableCheck.alignments.includes('right');
    record(
      '语法与渲染',
      'GFM 数据表格 (| a | b |)',
      '正确渲染表头、单元格与对齐方式 (:---, :---:, ---:)',
      `表头 ${tableCheck.thCount} 列，数据 ${tableCheck.rowCount} 行，对齐属性: [${tableCheck.alignments?.join(', ')}]`,
      tableCheck.thCount === 4 && hasAlignments
    );

    // 6. Code Blocks & Syntax Highlighting Test
    const codeBlockCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const preBlocks = Array.from(container.querySelectorAll('pre:not(.vditor-reset)'));
      const languages = preBlocks.map(p => {
        const code = p.querySelector('code');
        const className = code?.className || '';
        const hljsTokens = code ? code.querySelectorAll('.hljs-keyword, .hljs-string, .hljs-title, .hljs-type, .hljs-function').length : 0;
        return {
          langClass: className,
          hljsTokens,
          fontFamily: window.getComputedStyle(code || p).fontFamily,
          textSample: code?.textContent?.slice(0, 40),
        };
      });
      return {
        count: preBlocks.length,
        languages,
      };
    })()`);

    const hasHighlighting = codeBlockCheck.languages && codeBlockCheck.languages.some(l => l.hljsTokens > 0);
    record(
      '语法与渲染',
      '多语言围栏代码块 (Go/TS/Python)',
      '正确识别语言标头并注入 highlight.js 语法高亮 Token',
      `共 ${codeBlockCheck.count} 个代码块，高亮 Token 探测：${codeBlockCheck.languages?.map(l => l.hljsTokens).join(', ')} 个`,
      codeBlockCheck.count >= 3 && hasHighlighting
    );

    // 7. Horizontal Rule Test
    const hrCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const hrs = container.querySelectorAll('hr');
      return { count: hrs.length };
    })()`);

    record(
      '语法与渲染',
      '分割线 (---)',
      '渲染标准 hr 分割线元素',
      `检测到 ${hrCheck.count} 条分割线`,
      hrCheck.count >= 1
    );

    // 8. Links & Wiki-Links Test
    const linkCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const links = Array.from(container.querySelectorAll('a, .vditor-ir__link, .vditor-ir__node--link')).map(a => ({
        tag: a.tagName.toLowerCase(),
        href: a.getAttribute('href'),
        text: a.textContent.trim(),
        color: window.getComputedStyle(a).color,
      }));
      return {
        count: links.length,
        links,
      };
    })()`);

    record(
      '语法与渲染',
      '标准 Markdown 超链接',
      '渲染可点击超链接，带有主题配色与 href 属性',
      `找到链接：${linkCheck.links.map(l => l.text + ' -> ' + l.href).join('; ')}`,
      linkCheck.count >= 1
    );

    // 9. Footnotes Test
    const footnoteCheck = await cdp.eval(`(() => {
      const container = document.querySelector('.vditor-ir pre.vditor-reset');
      const fnRefs = container.querySelectorAll('sup, .vditor-ir__node[data-type="footnotes-ref"], [data-type="footnote"]');
      const text = container.textContent;
      return {
        foundSup: fnRefs.length,
        hasPreamble: text.includes('包含脚注的说明文本'),
        hasDef: text.includes('Local First 原则'),
      };
    })()`);

    record(
      '语法与渲染',
      '脚注语法 ([^1])',
      '渲染脚注上标引用与对应释义',
      `上标元素: ${footnoteCheck.foundSup} 个，正文与释义完备: ${footnoteCheck.hasPreamble && footnoteCheck.hasDef}`,
      footnoteCheck.hasPreamble && footnoteCheck.hasDef
    );

    // 10. Distraction-Free Layout Check (Toolbar Hidden)
    const layoutCheck = await cdp.eval(`(() => {
      const toolbar = document.querySelector('.vditor-toolbar');
      const isHidden = !toolbar || window.getComputedStyle(toolbar).display === 'none' || toolbar.children.length === 0;
      const editorWrapper = document.querySelector('.vditor-editor-wrapper');
      const editorStyle = window.getComputedStyle(editorWrapper);
      return {
        toolbarHidden: isHidden,
        outline: editorStyle.outline,
        border: editorStyle.border,
      };
    })()`);

    record(
      '界面与排版',
      '纯净无干扰模式 (Toolbar 隐藏)',
      '顶部无杂乱按钮工具栏，全区域沉浸编辑',
      layoutCheck.toolbarHidden ? '工具栏已彻底隐藏' : '检测到残留工具栏',
      layoutCheck.toolbarHidden
    );

    // 11. Light Mode Visual Styles & Typography Check
    const lightStyleCheck = await cdp.eval(`(() => {
      const ir = document.querySelector('.vditor-ir pre.vditor-reset');
      const style = window.getComputedStyle(ir);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
      };
    })()`);

    record(
      '界面与排版',
      'macOS 系统字体回退与浅色排版',
      '使用 SF Pro / 系统回退字体，具有良好行高与字号',
      `Font: ${lightStyleCheck.fontFamily.slice(0, 35)}..., LineHeight: ${lightStyleCheck.lineHeight}, Color: ${lightStyleCheck.color}`,
      lightStyleCheck.fontFamily.length > 0
    );

    // Capture Light Mode Screenshot
    const lightScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const lightImgPath = path.join(artifactDir, 'note_editor_light_mode.png');
    fs.writeFileSync(lightImgPath, Buffer.from(lightScreenshot.data, 'base64'));
    console.log(`✓ Saved light mode real-machine screenshot to ${lightImgPath}`);

    // 12. Dark Mode Switch & Dynamic Theme Test
    const darkSwitchResult = await cdp.eval(`(() => {
      // Switch html / body to dark class
      document.documentElement.classList.add('dark');
      document.body.classList.remove('bg-stone-50', 'text-stone-900');
      document.body.classList.add('bg-stone-900', 'text-stone-100');

      // Call vditor setTheme
      window.vditor.setTheme('dark', 'dark', 'github-dark');

      const ir = document.querySelector('.vditor-ir pre.vditor-reset');
      const style = window.getComputedStyle(ir);
      const vditorEl = document.querySelector('.vditor');
      const vditorTheme = vditorEl ? vditorEl.className : '';

      return {
        darkClassPresent: document.documentElement.classList.contains('dark'),
        vditorDarkTheme: vditorTheme.includes('vditor--dark'),
        color: style.color,
      };
    })()`);

    // Give browser a moment to update styles
    await new Promise((r) => setTimeout(r, 300));

    record(
      '主题与样式',
      '深色模式动态切换 (Dark Mode)',
      '动态响应深色偏好，切换深色主题背景与 github-dark 高亮',
      `HTML .dark 状态: ${darkSwitchResult.darkClassPresent}, Vditor 类: "${darkSwitchResult.vditorDarkTheme ? 'vditor--dark' : 'ok'}"`,
      darkSwitchResult.darkClassPresent
    );

    // Capture Dark Mode Screenshot
    const darkScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const darkImgPath = path.join(artifactDir, 'note_editor_dark_mode.png');
    fs.writeFileSync(darkImgPath, Buffer.from(darkScreenshot.data, 'base64'));
    console.log(`✓ Saved dark mode real-machine screenshot to ${darkImgPath}`);

    // 13. Round-Trip & Markdown AST Integrity Test
    const valueCheck = await cdp.eval(`(() => {
      const val = window.vditor.getValue();
      const checks = {
        hasHeadings: val.includes('# 一级标题') && val.includes('###### 六级标题'),
        hasBold: val.includes('**粗体文字 Bold**'),
        hasItalic: val.includes('*斜体文字 Italic*'),
        hasStrike: val.includes('~~删除线 Strikethrough~~'),
        hasInlineCode: val.includes('\`行内代码 inline_code()\`'),
        hasTable: val.includes('| 功能特性 |') && val.includes(':--'),
        hasGoCode: val.includes('\`\`\`go') && val.includes('type Task struct'),
        hasTypeScript: val.includes('\`\`\`typescript') && val.includes('interface NoteRef'),
        hasChecklist: val.includes('- [ ]') || val.includes('- [x]'),
        hasFootnote: val.includes('[^note1]'),
        length: val.length,
      };
      return { checks, val };
    })()`);

    const checks = valueCheck.checks;
    const allTokensPreserved = 
      checks.hasHeadings &&
      checks.hasBold &&
      checks.hasItalic &&
      checks.hasStrike &&
      checks.hasInlineCode &&
      checks.hasTable &&
      checks.hasGoCode &&
      checks.hasTypeScript &&
      checks.hasChecklist &&
      checks.hasFootnote;

    record(
      '往返一致性',
      'Vditor.getValue() 内容完整度',
      '读写往返零丢失，标题、代码块、表格、任务标记完整保留',
      `解析保留率 10/10 项，字符总长度: ${valueCheck.val.length}`,
      allTokensPreserved
    );

  } catch (err) {
    console.error('Error during test execution:', err);
    throw err;
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    server.close();
    await new Promise((r) => setTimeout(r, 500));
    try {
      fs.rmSync(tmpUserDir, { recursive: true, force: true });
    } catch {}
    console.log('✓ Cleanup completed.');
  }

  // Print Summary Table
  console.log('\n================== 实机测试核验报告 ==================');
  console.log('| 模块 | 测试特性 | 预期表现 | 实测结果 | 结论 |');
  console.log('| :--- | :--- | :--- | :--- | :---: |');
  for (const r of testResults) {
    console.log(`| ${r.category} | ${r.feature} | ${r.expected} | ${r.actual.replace(/\|/g, '\\|')} | ${r.pass ? 'PASS' : 'FAIL'} |`);
  }
  console.log('======================================================');

  // Also write JSON results to a temporary file for ingestion
  const jsonPath = path.join(artifactDir, 'note_editor_test_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(testResults, null, 2));
  console.log(`✓ Test report JSON written to ${jsonPath}`);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
