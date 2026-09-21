/**
 * The about page's text, in both languages.
 *
 * `landing.ts` made the front page's four words data; this does the same for the
 * one screen on the site that is prose. Kept out of the component for the usual
 * reason — the words are the thing being maintained, and nobody should have to
 * read JSX to change a sentence — and because a translation is then a sibling
 * value rather than a fork of the markup.
 *
 * The source of truth for this text is `ABOUT.md` at the root of the repo,
 * which is where it is written and revised; this module is where it is
 * published. When one changes, the other should follow.
 *
 * ## Why paragraphs are arrays
 *
 * Sentences carry links (the author, and the web archive the pages came from)
 * and the odd emphasised word, so a paragraph cannot be a plain string unless
 * the renderer parses markup out of it at runtime. It is a list of runs
 * instead: strings, `{ text, href }` where a link belongs, and
 * `{ text, emphasis }` where a phrase is set apart. That keeps this module free
 * of both HTML and a parser, and it means a translator moves the link with the
 * phrase it belongs to rather than counting placeholders.
 *
 * ## Why the sections are a shared list
 *
 * {@link ABOUT_SECTIONS} fixes the order and the colour once, for both
 * languages, and each language supplies only the words for each id. The two
 * versions therefore cannot drift out of step — a missing section is a type
 * error rather than a page that is shorter in Portuguese.
 */

import type { TeletextColor } from '../types/teletext';
import type { Language } from './landing';

/** A link inside a paragraph. */
export interface AboutLink {
  text: string;
  href: string;
}

/**
 * A phrase set apart from the rest of the sentence.
 *
 * Two kinds, because the prose uses two: the project's name where it is
 * introduced, and the handful of borrowed terms — *zeitgeist*, *pixel art* —
 * that a reader should see as quoted from another vocabulary.
 */
export interface AboutEmphasis {
  text: string;
  emphasis: 'strong' | 'em';
}

/** A stretch of a paragraph: plain text, a link, or an emphasised phrase. */
export type AboutRun = string | AboutLink | AboutEmphasis;

/** One paragraph, as the runs it is made of. */
export type AboutParagraph = readonly AboutRun[];

/** Whether a run is a link rather than plain text. */
export function isAboutLink(run: AboutRun): run is AboutLink {
  return typeof run !== 'string' && 'href' in run;
}

/** Whether a run is an emphasised phrase rather than plain text. */
export function isAboutEmphasis(run: AboutRun): run is AboutEmphasis {
  return typeof run !== 'string' && 'emphasis' in run;
}

/**
 * The sections, in order, each with the palette colour its heading takes.
 *
 * Teletext colour-coded its headings — that is what the eight colours were
 * mostly *for* — so the headings here take the same three the fastext strip ran,
 * in the same order the front page's menu uses them. Cyan is missing on purpose:
 * it belongs to the word "sobre" on the front page, and the page's own title
 * takes it, so arriving here the colour of the door carries on to the title.
 */
export const ABOUT_SECTIONS: readonly { id: AboutSectionId; color: TeletextColor }[] = [
  { id: 'teletext', color: 'red' },
  { id: 'archive', color: 'green' },
  { id: 'purpose', color: 'yellow' },
];

export type AboutSectionId = 'teletext' | 'archive' | 'purpose';

export interface AboutSection {
  heading: string;
  paragraphs: readonly AboutParagraph[];
  /**
   * Numbered points, where the section is a list of reasons rather than prose.
   *
   * Optional because only the last section is written that way: an empty array
   * on the other two would be a list that renders as nothing, which is a shape
   * a reader of this file would have to open the component to understand.
   */
  points?: readonly AboutParagraph[];
}

export interface AboutDoc {
  /** The page's own title, and its `<title>`. */
  title: string;
  /** Named for screen readers, since the prose is the whole page. */
  region: string;
  /** The paragraphs before the first heading. */
  intro: readonly AboutParagraph[];
  sections: Record<AboutSectionId, AboutSection>;
}

/**
 * The author's site, which has a language of its own: the Portuguese text links
 * to the Portuguese front door and the English text to `/en`, so following the
 * name mid-sentence does not switch language on the reader.
 */
const AUTHOR_PT = 'https://joaobernardo.me';
const AUTHOR_EN = 'https://joaobernardo.me/en';
const ARQUIVO = 'https://arquivo.pt';

/** The project's name where the prose introduces it, bold in both languages. */
const NAME: AboutEmphasis = { text: 'Tele-textual', emphasis: 'strong' };

export const ABOUT: Record<Language, AboutDoc> = {
  pt: {
    title: 'sobre',
    region: 'Sobre o projeto',
    intro: [
      [
        NAME,
        ' é uma instalação participativa de ',
        { text: 'João Bernardo Narciso', href: AUTHOR_PT },
        ' que permite navegar por um arquivo de antigas páginas de teletexto da televisão portuguesa. Para além do arquivo, qualquer pessoa pode criar novas páginas, que ficam acessíveis a todos. Assim, o Tele-textual é uma janela para espreitar um pouco do nosso passado coletivo ao mesmo tempo que permite a criação de coisas novas a partir de um conjunto de restrições impostas por uma tecnologia (aparentemente) obsoleta.',
      ],
      [
        'A experiência coletiva é central a este projeto. A navegação pelas páginas pode ser feita de forma isolada, ou em salas com outras pessoas, em que o grupo decide de forma coletiva que página ver a seguir. Várias pessoas também podem criar e editar páginas ao mesmo tempo, numa tela partilhada.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'O que é o teletexto?',
        paragraphs: [
          [
            'O teletexto é um serviço de transmissão de texto e gráficos simples através da televisão. Surgiu nos anos 70 no Reino Unido e popularizou-se um pouco por toda a Europa, mas chegou a Portugal apenas na segunda metade dos anos 90. Os canais transmitiam teletexto através de páginas numeradas do 100 ao 999. Estas podiam conter informação muito diversa, como notícias, previsões meteorológicas, resultados desportivos, prémios da lotaria, horóscopo, anúncios comerciais, entre muitos outros tipos de informação útil. Até classificados e salas de chat chegaram a existir, nas quais os utilizadores podiam participar através de mensagens SMS, incorporando no teletexto uma interatividade inesperada e que de certa forma antevia o que a internet viria a democratizar anos mais tarde.',
          ],
          [
            'Mesmo com o advento da internet, este serviço manteve durante muito tempo a sua importância, dada a sua gratuitidade, facilidade de uso e disseminação, uma vez que bastava ter um televisor para conseguir aceder.',
          ],
          [
            'O teletexto tem também uma importante funcionalidade de acessibilidade, uma vez que ainda hoje é comum os canais transmitirem o serviço de legendagem através da página 888.',
          ],
        ],
      },
      archive: {
        heading: 'Como se construiu o arquivo?',
        paragraphs: [
          [
            'Dada a efemeridade da maior parte das páginas, que eram muitas delas atualizadas ou reescritas diariamente, é muito difícil construir um arquivo exaustivo do teletexto. Os principais esforços de arquivo a nível internacional fazem-no à escala relativamente pequena, extraindo através de equipamento especializado a informação de teletexto presente em algumas gravações analógicas.',
          ],
          [
            'O arquivo do Tele-textual foi construído aproveitando um anacronismo tecnológico. Os canais RTP e SIC forneciam nas suas páginas web navegadores de teletexto. Assim, através do serviço de arquivo da web portuguesa ',
            { text: 'Arquivo.pt', href: ARQUIVO },
            ', foi possível compilar um total de 3170 páginas. Uma vez que o teletexto em Portugal foi introduzido relativamente tarde, sensivelmente ao mesmo tempo que a internet, este método permitiu criar um arquivo bastante completo, uma radiografia geral do que foi este serviço em Portugal.',
          ],
        ],
      },
      purpose: {
        heading: 'Qual o propósito deste projeto?',
        paragraphs: [],
        points: [
          [
            'O Tele-textual é um esforço de arquivo e divulgação de uma tecnologia de comunicação que esteve tão presente nas vidas de tantos, mas que gradualmente foi desaparecendo dos nossos hábitos e memórias. Interessa a tecnologia em si, e interessa igualmente a forma como foi usada e no que se decidiu comunicar através dela. As páginas arquivadas captam o ',
            { text: 'zeitgeist', emphasis: 'em' },
            ' das épocas em que foram publicadas e são de uma enorme variedade. É o caso das páginas sobre grandes eventos como a Expo 98 e o Porto 2001. Ou as dos conselhos da PSP para uma Escola Segura, em que se pedia às crianças que não expusessem os seus leitores de CD. Ou ainda os anúncios dos mal-afamados serviços de SMS, que prometiam toques polifónicos ou testes de compatibilidade amorosa (o serviço “TV Amor”), a troco de uma mensalidade escondida.',
          ],
          [
            'O Tele-textual é uma homenagem ao engenho de quem, com tantas limitações tecnológicas, desenhou verdadeiras obras de arte, que agora podem ser redescobertas, numa altura em que a ',
            { text: 'pixel art', emphasis: 'em' },
            ' tem despertado um interesse renovado.',
          ],
          [
            'A experiência coletiva é central no Tele-textual. Num mundo em que os ecrãs proliferam e em que o streaming é a principal forma de consumir conteúdos televisivos, reunir várias pessoas em torno de um mesmo ecrã, seja para ver ou para criar novas páginas, é um ato disruptivo.',
          ],
          [
            'Finalmente, o Tele-textual é uma ferramenta que estimula a criação de forma inovadora. Muitos artistas e pensadores fazem historicamente referência à ideia de restrição como motor criativo. Numa época em que a passagem da ideia à obra acabada é tecnicamente cada vez mais simples e acessível, é fascinante a experiência de tentar criar algo dentro das limitações que uma tecnologia supostamente arcaica impõe.',
          ],
        ],
      },
    },
  },
  en: {
    title: 'about',
    region: 'About the project',
    intro: [
      [
        NAME,
        ' is a participatory installation by ',
        { text: 'João Bernardo Narciso', href: AUTHOR_EN },
        ' built on an archive of old teletext pages from Portuguese television. Beyond the archive, anyone can create new pages, which then become accessible to everyone. Tele-textual is thus a window onto a piece of our collective past, while also enabling new things to be made within the constraints of a (seemingly) obsolete technology.',
      ],
      [
        'Collective experience is central to this project. Pages can be browsed alone or in rooms with other people, where the group collectively decides which page to view next. Several people can also create and edit pages at the same time on a shared canvas.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'What is teletext?',
        paragraphs: [
          [
            'Teletext is a service for broadcasting text and simple graphics via television. It emerged in the United Kingdom in the 1970s and spread across much of Europe, but only reached Portugal in the second half of the 1990s. Channels broadcast teletext as numbered pages from 100 to 999. These could contain a wide range of information: news, weather forecasts, sports results, lottery draws, horoscopes, commercial advertisements, and many other kinds of useful information. There were even classified ads and chat rooms, in which users could take part by sending SMS messages. This brought an unexpected interactivity to teletext that, in a way, anticipated what the internet would democratise years later.',
          ],
          [
            'Even with the advent of the internet, the service remained important for a long time because it was free, easy to use, and widely available: all you needed was a television set.',
          ],
          [
            'Teletext also serves an important accessibility function, since channels still commonly broadcast subtitles through page 888.',
          ],
        ],
      },
      archive: {
        heading: 'How was the archive built?',
        paragraphs: [
          [
            'Because most pages were ephemeral, with many updated or rewritten daily, it is very difficult to build a comprehensive teletext archive. The main international archiving efforts work on a relatively small scale, using specialised equipment to extract the teletext data embedded in certain analogue recordings.',
          ],
          [
            'The Tele-textual archive was built by taking advantage of a technological anachronism. The Portuguese RTP and SIC channels offered teletext browsers on their websites. Using ',
            { text: 'Arquivo.pt', href: ARQUIVO },
            ', the Portuguese web archive, it was possible to compile over three thousand pages. Since teletext arrived in Portugal relatively late, at roughly the same time as the internet, this method made it possible to build a respectably sized archive, providing an overview of what this service was like in Portugal.',
          ],
        ],
      },
      purpose: {
        heading: 'What is the purpose of this project?',
        paragraphs: [],
        points: [
          [
            'Tele-textual is an effort to archive and celebrate a communication technology that was so present in so many people’s lives, yet gradually faded from our habits and memories. The technology itself matters, and so do the ways it was used and what people chose to communicate through it. The archived pages capture the ',
            { text: 'zeitgeist', emphasis: 'em' },
            ' of the periods in which they were published and are enormously varied. Examples include pages about major events such as Expo 98 and Porto 2001 (European Culture Capital), the Police’s advice for its Safe School programme, which urged children not to show off their CD players, and the ads for SMS services promising polyphonic ringtones or love compatibility tests (the “TV Amor” service) in exchange for a hidden monthly fee.',
          ],
          [
            'Tele-textual is a tribute to the ingenuity of those who, under such severe technological limitations, designed true works of art, which can now be rediscovered at a time when ',
            { text: 'pixel art', emphasis: 'em' },
            ' is enjoying renewed interest.',
          ],
          [
            'Collective experience is central to Tele-textual. In a world where screens proliferate and streaming is the main way of watching television content, gathering several people around a single screen, whether to watch or to create new pages, is a disruptive act.',
          ],
          [
            'Finally, Tele-textual is a tool that encourages creativity in an innovative way. Many artists and thinkers have historically pointed to constraint as a creative engine. At a time when getting from an idea to a finished work is technically ever simpler and more accessible, it is fascinating to try to create something within the limitations imposed by a supposedly archaic technology.',
          ],
        ],
      },
    },
  },
};
