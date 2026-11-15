import { captureProblem } from '@salamifocus/domain';
import { useRef, useState } from 'react';
import { captureText } from './writes.ts';

/**
 * Quick capture into the Inbox from anywhere. Enter saves what was typed and
 * clears the box for the next one; Enter with nothing typed, or Escape,
 * closes it. Moving focus away saves what was typed rather than losing it.
 */
export function CaptureBox({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(0);
  const typed = useRef('');
  const closed = useRef(false);

  function save() {
    if (captureProblem(typed.current)) return false;
    void captureText(typed.current);
    typed.current = '';
    setText('');
    setSaved((n) => n + 1);
    return true;
  }

  function close(keep: boolean) {
    if (closed.current) return;
    closed.current = true;
    if (keep) save();
    onClose();
  }

  return (
    <div role="dialog" aria-label="Capture to Inbox" className="capture-box">
      <input
        aria-label="Capture"
        placeholder="Capture to Inbox"
        autoFocus
        value={text}
        onChange={(e) => {
          typed.current = e.target.value;
          setText(e.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!save()) close(false);
          }
          if (event.key === 'Escape') close(false);
        }}
        onBlur={() => close(true)}
      />
      <p className="hint" role="status">
        {saved === 0 ? 'Enter saves to the Inbox. Escape closes.' : `${saved} saved to the Inbox. Enter on an empty box or Escape closes.`}
      </p>
    </div>
  );
}
