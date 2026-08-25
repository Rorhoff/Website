import type { NumberedNote } from "@/lib/general-notes";
import styles from "./board.module.css";

type Props = {
  notes: NumberedNote[];
};

export function GeneralNotesBlock({ notes }: Props) {
  if (notes.length === 0) return null;

  return (
    <div className={styles.generalNotes}>
      <div className={styles.generalNotesHead}>GENERAL NOTES</div>
      <ol className={styles.generalNotesList}>
        {notes.map((n) => (
          <li key={n.id} value={n.number}>
            {n.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
