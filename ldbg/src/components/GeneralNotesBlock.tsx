import type { NumberedNote } from "@/lib/general-notes";
import styles from "./board.module.css";

type Props = {
  notes: NumberedNote[];
  /** Always render the panel (export sheet shows placeholder when empty). */
  alwaysShow?: boolean;
};

export function GeneralNotesBlock({ notes, alwaysShow = false }: Props) {
  if (!alwaysShow && notes.length === 0) return null;

  return (
    <div className={styles.generalNotes}>
      <div className={styles.generalNotesHead}>General notes</div>
      {notes.length > 0 ? (
        <ul className={styles.generalNotesList}>
          {notes.map((n) => (
            <li key={n.id}>{n.text}</li>
          ))}
        </ul>
      ) : (
        <div className={styles.placeholder}>General notes — enable notes in sheet settings</div>
      )}
    </div>
  );
}
