import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../lib/api';
import type { Profile, Message, Conversation } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { Send, MessageSquare, ArrowLeft, Search } from 'lucide-react';

type ConversationWithDetails = Conversation & {
  otherUser: Profile | null;
  lastMessage?: Message;
};

type Props = {
  initialUserId?: string | null;
  onClearInitial: () => void;
};

export default function MessagesPage({ initialUserId, onClearInitial }: Props) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<(Message & { sender?: Profile })[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api.listConversations();
      setConversations(
        list.map(c => ({
          ...c,
          otherUser: c.otherUser ?? null,
          lastMessage: c.lastMessage,
        })) as ConversationWithDetails[],
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!initialUserId || !user) return;
    let cancelled = false;

    (async () => {
      const list = await api.listConversations();
      const existing = list.find(c => c.otherUser?.id === initialUserId);
      if (existing && !cancelled) {
        setSelectedConvId(existing.id);
        setMobileView('chat');
        onClearInitial();
        await loadConversations();
        return;
      }
      if (cancelled) return;
      const created = await api.createConversation(initialUserId);
      await loadConversations();
      if (!cancelled) {
        setSelectedConvId(created.id);
        setMobileView('chat');
      }
      onClearInitial();
    })();

    return () => { cancelled = true; };
  }, [initialUserId, user?.id]);

  async function loadMessages(convId: string) {
    const data = await api.listMessages(convId);
    setMessages(data);
  }

  useEffect(() => {
    if (!selectedConvId) return;
    loadMessages(selectedConvId);
    const interval = setInterval(() => loadMessages(selectedConvId), 3000);
    return () => clearInterval(interval);
  }, [selectedConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMsg.trim() || !selectedConvId || !user) return;
    setSending(true);
    const content = newMsg.trim();
    setNewMsg('');
    try {
      await api.sendMessage(selectedConvId, content);
      await loadMessages(selectedConvId);
      await loadConversations();
    } finally {
      setSending(false);
    }
  }

  const filteredConversations = conversations.filter(c => {
    const q = search.toLowerCase();
    if (!q) return true;
    const name = c.otherUser?.full_name?.toLowerCase() || '';
    const username = c.otherUser?.username?.toLowerCase() || '';
    return name.includes(q) || username.includes(q);
  });

  const selectedConv = conversations.find(c => c.id === selectedConvId);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto pb-20 md:pb-0">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 h-[70vh] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 md:pb-0">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden flex h-[calc(100vh-10rem)] md:h-[70vh]">
        {/* Conversation list */}
        <div className={`${mobileView === 'chat' && isMobile ? 'hidden' : 'flex'} flex-col w-full md:w-80 border-r border-gray-800 flex-shrink-0`}>
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-white font-bold mb-3">Messages</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageSquare size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No conversations yet</p>
              </div>
            ) : (
              filteredConversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => { setSelectedConvId(conv.id); setMobileView('chat'); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition text-left border-b border-gray-800/50 ${selectedConvId === conv.id ? 'bg-gray-800/80' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {conv.otherUser?.avatar_url ? (
                      <img src={conv.otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-blue-400 font-semibold text-sm">
                        {conv.otherUser?.full_name?.charAt(0) || '?'}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-sm font-medium truncate">{conv.otherUser?.full_name || 'Unknown'}</div>
                    <div className="text-gray-500 text-xs truncate">{conv.lastMessage?.content || 'No messages yet'}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat pane */}
        <div className={`${mobileView === 'list' && isMobile ? 'hidden' : 'flex'} flex-col flex-1 min-w-0`}>
          {selectedConvId && selectedConv ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                {isMobile && (
                  <button onClick={() => setMobileView('list')} className="text-gray-400 hover:text-white">
                    <ArrowLeft size={18} />
                  </button>
                )}
                <div className="text-white font-semibold text-sm">{selectedConv.otherUser?.full_name}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(msg => {
                  const isMine = msg.sender_id === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${isMine ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-200'}`}>
                        {msg.content}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={sendMessage} className="p-4 border-t border-gray-800 flex gap-2">
                <input
                  value={newMsg}
                  onChange={e => setNewMsg(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={sending || !newMsg.trim()}
                  className="w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl transition"
                >
                  <Send size={16} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
              Select a conversation to start chatting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
