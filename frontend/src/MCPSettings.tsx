import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plug } from 'lucide-react';
import { Clipboard } from '@wailsio/runtime';
import * as MCPService from '../bindings/pata/mcpservice';
import type { MCPStatus } from '../bindings/pata/models';
import { Button } from './components/ui/button';

export function MCPSettings() {
  const [status, setStatus] = useState<MCPStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);
  const changing = useRef(false);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const refresh = async () => {
      if (changing.current) return;
      const request = ++sequence.current;
      try {
        const next = await MCPService.GetStatus();
        if (request === sequence.current) setStatus(next);
      } catch {
        if (request === sequence.current) setError('无法读取 MCP 状态，请重新打开设置');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      sequence.current++;
      window.clearInterval(timer);
      window.clearTimeout(copyTimer.current);
    };
  }, []);

  const toggle = async (stop = false) => {
    if (changing.current) return;
    changing.current = true;
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const next = (stop || status?.running) ? await MCPService.Stop() : await MCPService.Start();
      if (request === sequence.current) setStatus(next);
    } catch (err) {
      if (request === sequence.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      changing.current = false;
      if (request === sequence.current) setBusy(false);
    }
  };

  const prompt = status?.running ? `帮我在当前客户端配置中新增名为 pata 的 MCP 服务，使用 Streamable HTTP 传输协议，连接地址为 ${status.endpoint}，仅增量修改并保留原有配置，最后通过列出工具验证接入是否成功。` : '';

  const copy = async () => {
    try {
      await Clipboard.SetText(prompt);
      setCopied(true);
      setError('');
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请选中下方接入说明手动复制');
    }
  };

  return <section aria-labelledby="mcp-heading" className="rounded-xl border border-stone-200/80 dark:border-stone-800/80 bg-white/70 dark:bg-stone-900/60 p-5 shadow-2xs space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="mcp-heading" className="text-sm font-semibold flex items-center gap-2"><Plug className="w-4 h-4" />MCP</h2>
      <div className="flex items-center gap-3">
        <span role="status" className="text-xs text-stone-500">{status ? status.running ? '运行中' : '未启动' : '读取状态…'}</span>
        <Button variant={status?.running ? 'outline' : 'default'} disabled={!status} loading={busy} onClick={() => void toggle()}>
          {status?.running ? '停止服务' : '启动 MCP 服务'}
        </Button>
        {status?.enabled && !status.running && <Button variant="outline" loading={busy} onClick={() => void toggle(true)}>取消自动启动</Button>}
      </div>
    </div>
    {status?.vaultChanged && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">资料库已更换。请停止并重新启动服务，允许 Agent 访问当前资料库。</p>}
    {(error || status?.error) && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error || status?.error}</p>}
    {status?.running && <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="mcp-agent-prompt" className="text-xs font-medium">Agent 接入说明</label>
        <Button variant="outline" size="sm" onClick={() => void copy()} disabled={status.vaultChanged}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已复制' : '复制接入说明'}
        </Button>
      </div>
      <textarea id="mcp-agent-prompt" readOnly value={prompt} rows={6} className="block w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 px-3 py-2 text-xs leading-relaxed text-stone-700 dark:text-stone-300 resize-y select-text" />
    </div>}
  </section>;
}
