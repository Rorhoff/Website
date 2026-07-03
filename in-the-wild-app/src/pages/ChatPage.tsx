import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, Send, Shield } from 'lucide-react';
import * as api from '../lib/api';
import { formatCountdown, type ChatMessage } from '../lib/types';

type Props = {
  matchId: string;
  onBack: () => void;
};

export default function ChatPage({ matchId, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [canSend, setCanSend] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.fetchMessages(matchId);
      setMessages(data.messages);
      setExpiresAt(data.chat_expires_at);
      setCanSend(Boolean(data.can_send));
      setBlockReason(data.block_reason ?? null);
      const left = Math.max(0, Math.floor((new Date(data.chat_expires_at).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load chat');
    }
  }, [matchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || secondsLeft <= 0 || !canSend) return;
    try {
      const msg = await api.sendMessage(matchId, body.trim());
      setMessages(prev => [...prev, msg]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  }

  const sendBlocked = !canSend;

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3 mb-4 -mt-2">
        <button onClick={onBack} className="text-stone-400 hover:text-white p-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">Venue chat</p>
          <p className="text-amber-400 text-xs flex items-center gap-1">
            <Clock size={12} />
            {secondsLeft > 0 ? `${formatCountdown(secondsLeft)} left — go say hi!` : 'Expired'}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-3 bg-red-950/30 rounded-xl px-3 py-2">{error}</p>
      )}

      {sendBlocked && blockReason && (
        <div className="mb-4 flex items-start gap-2 bg-amber-950/40 border border-amber-800/50 rounded-xl px-3 py-3 text-amber-200 text-sm">
          <Shield size={16} className="flex-shrink-0 mt-0.5" />
          <span>{blockReason}</span>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto mb-4 min-h-[200px]">
        {messages.length === 0 && (
          <p className="text-stone-600 text-sm text-center py-8">
            Coordinate a quick meet-up — then introduce yourself in person.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.mine ? 'bg-emerald-600 text-white' : 'bg-stone-800 text-stone-200'
              }`}
            >
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex gap-2 sticky bottom-20 bg-stone-950 pt-2">
        <input
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={secondsLeft <= 0 || sendBlocked}
          placeholder={
            sendBlocked
              ? 'Chat unavailable'
              : secondsLeft > 0
                ? 'Quick hello…'
                : 'Chat expired'
          }
          className="flex-1 bg-stone-900 border border-stone-700 rounded-xl px-4 py-3 text-white disabled:opacity-50 focus:outline-none focus:border-emerald-600"
        />
        <button
          type="submit"
          disabled={secondsLeft <= 0 || !body.trim() || sendBlocked}
          className="w-12 h-12 bg-emerald-600 disabled:opacity-40 rounded-xl flex items-center justify-center text-white"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
