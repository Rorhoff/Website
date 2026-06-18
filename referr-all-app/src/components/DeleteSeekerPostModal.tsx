import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { SeekerPost } from '../lib/types';
import { isPremiumActive } from '../lib/premium';
import {
  formatUsd,
  premiumRefundBlockedMessage,
  prorationLabel,
} from '../lib/premiumRefund';
import { Loader, Trash2, X } from 'lucide-react';

type Props = {
  post: SeekerPost | null;
  onClose: () => void;
  onDeleted: (result: { refundCents?: number }) => void;
};

export default function DeleteSeekerPostModal({ post, onClose, onDeleted }: Props) {
  const [preview, setPreview] = useState<api.PremiumRefundPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const featured = post ? isPremiumActive(post) : false;

  useEffect(() => {
    if (!post) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    if (!featured) {
      setPreview(null);
      setPreviewError('');
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    api.getPremiumRefundPreview(post.id)
      .then(data => {
        if (!cancelled) setPreview(data);
      })
      .catch(err => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : 'Could not load refund estimate.');
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [post, featured]);

  if (!post) return null;

  async function handleDelete() {
    setDeleting(true);
    setError('');
    try {
      const result = await api.deleteSeekerPost(post!.id);
      onDeleted(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete seeker post');
    } finally {
      setDeleting(false);
    }
  }

  const bd = preview?.breakdown;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Delete seeker post?</h2>
          <button
            onClick={onClose}
            disabled={deleting}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-gray-400 text-sm leading-relaxed">
            {featured
              ? 'This will permanently remove your featured seeker post. Unused featured time may be refunded to your card (see estimate below).'
              : 'This will permanently remove your seeker post. This cannot be undone.'}
          </p>

          {featured && (
            <div className="rounded-xl border border-gray-800 bg-gray-950/80 p-4 text-sm">
              {previewLoading && (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader size={14} className="animate-spin" />
                  Loading refund estimate…
                </div>
              )}
              {previewError && (
                <p className="text-amber-300/90">{previewError}</p>
              )}
              {!previewLoading && preview && !preview.breakdown && !preview.eligible && (
                <p className="text-gray-500">{premiumRefundBlockedMessage(preview.blockedReason)}</p>
              )}
              {!previewLoading && bd && (
                <>
                  {!preview.eligible ? (
                    <p className="text-amber-300/90">{premiumRefundBlockedMessage(preview.blockedReason)}</p>
                  ) : (
                    <>
                      <p className="text-gray-500 text-xs font-medium mb-3">Featured refund estimate (card)</p>
                      <div className="space-y-2 text-gray-300">
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-500">Featured payment</span>
                          <span>{formatUsd(bd.grossPaidCents)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-500">Stripe processing fee ({bd.stripeFeeLabel})</span>
                          <span className="text-red-400/90">−{formatUsd(bd.stripeFeeCents)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-gray-500">Refundable pool</span>
                          <span>{formatUsd(bd.netAfterFeeCents)}</span>
                        </div>
                        <div className="text-gray-500 text-xs pt-1">{prorationLabel(preview)}</div>
                        <div className="flex justify-between gap-4 pt-2 border-t border-gray-800 font-semibold text-white">
                          <span>Estimated refund</span>
                          <span className="text-emerald-400">{formatUsd(preview.refundCents)}</span>
                        </div>
                      </div>
                      <p className="text-gray-600 text-xs mt-3">
                        Minimum refund is {formatUsd(bd.minimumRefundCents)}. Final amount posts via Stripe in a few business days.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={deleting}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-xl py-3 text-sm transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 flex items-center justify-center gap-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 font-semibold rounded-xl py-3 text-sm transition disabled:opacity-50"
            >
              {deleting ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete permanently
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
