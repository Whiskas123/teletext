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
 * Two sentences carry links (the author, and the web archive the pages came
 * from), so a paragraph cannot be a plain string unless the renderer parses
 * markup out of it at runtime. It is a list of runs instead: strings, and
 * `{ text, href }` where a link belongs. That keeps this module free of both
 * HTML and a parser, and it means a translator moves the link with the phrase
 * it belongs to rather than counting placeholders.
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

/** A stretch of a paragraph: plain text, or text that is a link. */
export type AboutRun = string | AboutLink;

/** One paragraph, as the runs it is made of. */
export type AboutParagraph = readonly AboutRun[];

/** Whether a run is a link rather than plain text. */
export function isAboutLink(run: AboutRun): run is AboutLink {
  return typeof run !== 'string';
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
  { id: 'takingPart', color: 'yellow' },
];

export type AboutSectionId = 'teletext' | 'archive' | 'takingPart';

export interface AboutSection {
  heading: string;
  paragraphs: readonly AboutParagraph[];
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

export const ABOUT: Record<Language, AboutDoc> = {
  pt: {
    title: 'sobre',
    region: 'Sobre o projeto',
    intro: [
      [
        'Tele-textual é uma instalação participativa criada por ',
        { text: 'João Bernardo Narciso', href: AUTHOR_PT },
        ', construída com base num arquivo de teletexto dos canais portugueses. Reúne uma criteriosa selecção de páginas recuperadas do arquivo web ',
        { text: 'Arquivo.pt', href: ARQUIVO },
        ', incluindo páginas de notícias, meteorologia, desporto, lotaria, classificados, horóscopo e serviços de SMS, e volta a colocá-las num ecrã acessível a todos. As páginas podem ser visualizadas individualmente ou em grupo, onde todos decidem em conjunto qual a página a carregar a seguir e aguardam que apareça. Para além do arquivo, é possível criar novas páginas de teletexto, na mesma grelha e com as mesmas restrições que esta tecnologia impunha. Esta obra reside no espaço entre estas duas partes: por um lado é uma forma lenta e coletiva de observar algo que pertence ao passado e que está praticamente perdido, e por outro lado é uma forma de criar coisas novas através um conjunto de restrições impostas por uma tecnologia obsoleta.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'teletexto',
        paragraphs: [
          [
            'Desde o final dos anos 70 e até aos dias de hoje em alguns países, o sinal de televisão transmitia um serviço de texto numa banda de sinal que até então não era utilizada. Carregava-se no botão "TXT" no comando, marcavam-se três dígitos e esperava-se, às vezes um segundo, às vezes o suficiente para se perguntar se se tinha marcado o número errado. Depois, a página aparecia no ecrã: quarenta caracteres de largura, vinte e quatro linhas de altura, a oito cores e nada mais. A página 100 era o índice, a página 888 eram as legendas. A previsão do tempo estava algures na faixa dos 400 e os resultados da lotaria estava onde o canal os tivesses colocado. Memorizavam-se os números da mesma forma que se memorizavam números de telefone.',
          ],
          [
            'Era uma pequena e lenta "proto-internet" pública que vivia dentro da televisão. Tenho interesse nele porque representa uma ideia particular da esfera pública, da informação como infraestrutura, leve por design, disponível para todos ao mesmo tempo, gratuitamente. Foi também uma das tecnologias de acessibilidade mais importantes que a televisão já teve, tornando o meio utilizável para os telespectadores surdos e com deficiência auditiva através de legendas e serviços de texto. E tinha uma vida social inesperada, uma vez que alguns serviços mantinham páginas de chat onde as mensagens SMS apareciam no ecrã para todos.',
          ],
        ],
      },
      archive: {
        heading: 'o arquivo',
        paragraphs: [
          [
            'O Tele-textual não é um arquivo completo nem poderia ser. O teletexto foi concebido para ir sendo re-escrito e quase nada foi preservado. O que está aqui reunido é uma seleção do que o webcrawler do Arquivo.pt conseguiu captar nos dias em que passou pelas páginas web dos canais portugueses  quando nelas era oferecido o serviços de teletexto online.',
          ],
        ],
      },
      takingPart: {
        heading: 'participar',
        paragraphs: [
          [
            'Podes ver sozinho, consultando o indíce nas páginas amarelas, marcando um número, ou seguindo os links. Ou podes entrar numa sala e ter uma experiência coletiva. Todos na sala veem a mesma página ao mesmo tempo e conversam na margem. Ninguém fica com o comando, um pedido de mudança de página leva a uma votação e necessita da aprovação da maioria dos espectadores. Depois, esperam juntos que a página apareça, como nos velhos tempos do teletexto. Ler teletexto era algo que costumávamos fazer numa sala, em voz alta, com quem estivesse presente. A maior parte do que criamos para a web é concebido para ser utilizado individualmente e rapidamente. Esta é uma tentativa de fazer o contrário.',
          ],
          [
            'As páginas de arquivo não são o site todo. Qualquer pessoa pode abrir o editor e criar uma página seguindo as limitações do teletexto: 40 por 24 blocos, oito cores, texto simples ou com altura dupla, gráficos em mosaico que podem piscar. As páginas a partir da 700 estão abertas a todos, e uma página que está a ser editada muda em direto nos ecrãs de qualquer pessoa que a esteja a ver.',
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
        'Tele-textual is a participatory installation made by ',
        { text: 'João Bernardo Narciso', href: AUTHOR_EN },
        ' built on the Portuguese teletext archive. It gathers a curated selection of pages recovered the portuguese web archive ',
        { text: 'Arquivo.pt', href: ARQUIVO },
        ' including news, weather, sports, lottery, classifieds, horoscopes, and SMS services, and puts them back on a screen accessible to everyone. The pages can watched alone or in a room with other people, where the group decides together which page to load next and waits for it to arrive. Alongside the archive there is an editor, so anyone can make a new page in the same grid and with the same constraints the broadcasters had. This work lives in the space between those two halves: a slow, collective way of looking at something that is mostly lost, and a set of old constraints handed back to whoever wants to be creative and make something new inside them.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'teletext',
        paragraphs: [
          [
            "From the late 70s up to this day in some countries, the television signal carried a text service in its unused lines. You pressed TXT on the remote, typed three digits, and waited, sometimes a second, sometimes long enough to wonder if you'd typed the wrong number. Then, the page assembled itself: forty characters wide, twenty-four rows deep, in eight colours and nothing else. Page 100 was the index, page 888 was subtitles. The weather was somewhere in the 400s and the lottery was wherever the channel had put it, and you learned the numbers the way you learn a phone number.",
          ],
          [
            'It was a small, slow, public "proto-internet" living inside the television. I\'m interested in it because it holds a particular idea of the public sphere, of information as infrastructure, lightweight by design, available to everyone at once, free. It was also one of the most important accessibility technologies television ever had, making the medium usable for deaf and hard-of-hearing viewers through subtitles and text services. And it had a social life nobody planned for, as some services ran chat pages where SMS messages appeared on screen for everyone.',
          ],
        ],
      },
      archive: {
        heading: 'the archive',
        paragraphs: [
          [
            "This is not a complete archive, and it couldn't be. Teletext was designed to be overwritten and almost none of it was kept. What is collected here is a curated selection of what a web crawler happened to catch on the days it happened to run, when Portuguese broadcasters mirrored their teletext services online.",
          ],
        ],
      },
      takingPart: {
        heading: 'taking part',
        paragraphs: [
          [
            "You can watch on your own: dial a page, follow the coloured links, search every page by what's written on it. Or you can open a room and have a collective experience. Everyone in the room sees the same page at the same moment and talks in the margin. Nobody holds the remote, as changing the page is a request leads to a voting and needs the approval of the majority of watchers. You wait, together, for a page to arrive, like in the old teletext days. Reading teletext was something we used to do in a room, out loud, with whoever else was there. Most of what we build for the web is designed to be used alone and at speed. This is an attempt at the other thing.",
          ],
          [
            "The old pages aren't the whole site. Anyone can open the editor and make a page under teletext constraints: forty by twenty-four, eight colours, simple or double height text, mosaic graphics that can blink. Pages 700 and up are open to everyone, and a page being edited changes live on the screens of anyone watching it.",
          ],
        ],
      },
    },
  },
};
