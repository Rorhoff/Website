import { useState } from 'react';
import { Briefcase, ChevronDown, Plus, User } from 'lucide-react';

type Props = {
  onJob: () => void;
  onSeeker: () => void;
  hasOwnSeekerPost?: boolean;
};

export default function PostActionDropdown({ onJob, onSeeker, hasOwnSeekerPost = false }: Props) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  function handleJob() {
    close();
    onJob();
  }

  function handleSeeker() {
    if (hasOwnSeekerPost) {
      alert('You already have a seeker post. Delete it from your profile before creating a new one.');
      return;
    }
    close();
    onSeeker();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1.5 sm:gap-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-3 sm:px-4 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-blue-500/20"
      >
        <Plus size={16} />
        Post
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-52 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
            <button
              type="button"
              onClick={handleJob}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition text-left"
            >
              <Briefcase size={15} className="text-blue-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Post Job Opening</div>
                <div className="text-xs text-gray-500">Share a referral opportunity</div>
              </div>
            </button>
            <div className="border-t border-gray-800" />
            <button
              type="button"
              onClick={handleSeeker}
              disabled={hasOwnSeekerPost}
              className={`flex items-center gap-3 w-full px-4 py-3 text-sm transition text-left ${
                hasOwnSeekerPost
                  ? 'text-gray-600 cursor-not-allowed'
                  : 'text-gray-300 hover:text-white hover:bg-gray-800'
              }`}
            >
              <User size={15} className="text-emerald-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Post Yourself</div>
                <div className="text-xs text-gray-500">Let employers find you</div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
