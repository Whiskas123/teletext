/**
 * Writing or correcting a screen's English by hand, line by line.
 *
 * One field per run (see `domain/subtitles.ts`), under the Portuguese it
 * replaces and no longer than the cells that run has: the EN key draws the
 * English into exactly those cells, so a longer line would be cut. An empty
 * field leaves the line in Portuguese, and so does one that drops a number the
 * Portuguese had (`keepsNumbers`) — said here, before saving, rather than
 * discovered on the TV.
 *
 * The draft is the parent's, so the inspector's preview can show it as it is
 * typed.
 */

import { keepsNumbers, type SubtitleRun } from '../../domain/subtitles';

export interface EnglishEditorProps {
  lines: readonly { run: SubtitleRun; en: string }[];
  draft: readonly string[];
  onChange(index: number, text: string): void;
  onSave(): void;
  onCancel(): void;
  saving: boolean;
}

export function EnglishEditor({ lines, draft, onChange, onSave, onCancel, saving }: EnglishEditorProps) {
  return (
    <form
      className="mg-en-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <ol className="mg-en-lines">
        {lines.map(({ run }, i) => {
          const width = run.end - run.start;
          const text = draft[i] ?? '';
          const dropsNumber = text.trim() !== '' && !keepsNumbers(run.text, text);
          return (
            <li key={`${run.row}:${run.start}`} className="mg-en-line">
              <label className="mg-field">
                <span className="mg-label-row">
                  <span className="mg-en-pt" lang="pt">
                    {run.text}
                  </span>
                  <span className="mg-count">
                    {text.length}/{width}
                  </span>
                </span>
                <input
                  className="mg-input mg-input-small mg-en-input"
                  lang="en"
                  value={text}
                  maxLength={width}
                  placeholder="Stays in Portuguese"
                  aria-label={`English for row ${run.row + 1}: ${run.text}`}
                  onChange={(event) => onChange(i, event.target.value)}
                />
              </label>
              {dropsNumber && (
                <p className="mg-note mg-note-warn">A number from the Portuguese is missing, so this line stays Portuguese.</p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mg-en-actions">
        <button type="submit" className="mg-btn mg-btn-small" disabled={saving}>
          {saving ? 'Saving…' : 'Save English'}
        </button>
        <button type="button" className="mg-btn mg-btn-small mg-btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
