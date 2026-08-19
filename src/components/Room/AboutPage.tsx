import { Link } from 'react-router-dom';

import {
  ABOUT,
  ABOUT_SECTIONS,
  isAboutLink,
  type AboutParagraph,
} from '../../domain/about';
import { LANDING_COPY } from '../../domain/landing';
import { useCopy } from './useCopy';
import { useLanguage } from './useLanguage';

/**
 * AboutPage — the one screen on the site that is prose, at `/about`.
 *
 * Reached from "sobre" on the front page, and built to look like the page it
 * came from: black, the same gutters, headings in the palette. The words live in
 * `domain/about.ts`; this only lays them out.
 *
 * ## Why this screen has a language switch
 *
 * The watching screens deliberately have none — see {@link useCopy} — because a
 * language toggle on a television cabinet is a control the television never had,
 * and by the time you are watching you have already answered the question on the
 * front page. Neither reason holds here. This is a wall label, not a set; and it
 * is the page most likely to be opened from a link someone was sent, by a reader
 * who has never seen the front page and so has never been asked. So the switch
 * comes along, in the same corner and the same shape as the one it borrows.
 */
export function AboutPage() {
  const { language, other, toggle } = useLanguage();
  const copy = useCopy();
  const doc = ABOUT[language];

  return (
    <div className="about">
      <header className="about-head">
        <Link to="/" className="room-back-link" aria-label={copy.layout.backHome}>
          <span className="room-back-arrow" aria-hidden="true">
            &lt;
          </span>
          <img src="/logo.png" alt="" className="room-back-logo" />
        </Link>

        {/* The front page's switch, class for class: one control, `PT/EN`, with
            the current language lit. Duplicating its look under a new name would
            leave two switches to keep in agreement. */}
        <button
          type="button"
          className="frontpage-lang"
          onClick={toggle}
          aria-label={`${LANDING_COPY[language].languageSwitch}: ${language.toUpperCase()} — ${other.toUpperCase()}`}
        >
          <span className="frontpage-lang-on">{language.toUpperCase()}</span>
          <span className="frontpage-lang-sep" aria-hidden="true">
            /
          </span>
          <span className="frontpage-lang-off">{other.toUpperCase()}</span>
        </button>
      </header>

      <main className="about-body" aria-label={doc.region}>
        <h1 className="about-title teletext-fg-cyan">{doc.title}</h1>

        {doc.intro.map((paragraph, index) => (
          <p key={index} className="about-para about-intro">
            <Paragraph runs={paragraph} />
          </p>
        ))}

        {ABOUT_SECTIONS.map(({ id, color }) => {
          const section = doc.sections[id];
          return (
            <section key={id} className="about-section" aria-labelledby={`about-${id}`}>
              <h2 id={`about-${id}`} className={`about-heading teletext-fg-${color}`}>
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="about-para">
                  <Paragraph runs={paragraph} />
                </p>
              ))}
            </section>
          );
        })}
      </main>
    </div>
  );
}

/**
 * One paragraph's runs: plain text, and the odd link.
 *
 * Both links here leave the site, so both carry `rel="noreferrer"` and open in a
 * new tab — a reader following the author's name mid-sentence is not leaving,
 * they are glancing, and losing a room they were watching in to do it would be a
 * real cost.
 */
function Paragraph({ runs }: { runs: AboutParagraph }) {
  return (
    <>
      {runs.map((run, index) =>
        isAboutLink(run) ? (
          <a
            key={index}
            className="about-link"
            href={run.href}
            target="_blank"
            rel="noreferrer"
          >
            {run.text}
          </a>
        ) : (
          <span key={index}>{run}</span>
        ),
      )}
    </>
  );
}

export default AboutPage;
