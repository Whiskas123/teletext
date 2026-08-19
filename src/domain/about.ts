/**
 * The about page's text, in both languages.
 *
 * `landing.ts` made the front page's four words data; this does the same for the
 * one screen on the site that is prose. Kept out of the component for the usual
 * reason — the words are the thing being maintained, and nobody should have to
 * read JSX to change a sentence — and because a translation is then a sibling
 * value rather than a fork of the markup.
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

const AUTHOR = 'https://joaobernardo.me/en';
const ARQUIVO = 'https://arquivo.pt';

export const ABOUT: Record<Language, AboutDoc> = {
  pt: {
    title: 'sobre',
    region: 'Sobre o projeto',
    intro: [
      [
        'O Tele-textual é uma instalação participativa de ',
        { text: 'João Bernardo Narciso', href: AUTHOR },
        ', construída sobre o arquivo do teletexto português. Reúne alguns milhares de páginas recuperadas do arquivo da web ',
        { text: 'Arquivo.pt', href: ARQUIVO },
        ' — notícias, meteorologia, futebol, lotarias, classificados, horóscopos e serviços de SMS — e volta a pô-las num ecrã. Podem ser vistas sozinho, ou numa sala com outras pessoas, onde o grupo decide em conjunto que página carregar a seguir e espera que ela chegue. Ao lado do arquivo há um editor, e qualquer pessoa pode fazer uma página nova na mesma grelha que os canais tinham. O trabalho vive no espaço entre essas duas metades: uma maneira lenta e colectiva de olhar para uma coisa que está quase toda perdida, e um conjunto de limitações antigas devolvido a quem quiser ser criativo e fazer algo novo lá dentro.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'teletexto',
        paragraphs: [
          [
            'Durante algumas décadas o sinal de televisão transportou um serviço de texto nas suas linhas não usadas. Carregavas em TXT no comando, marcavas três dígitos, e esperavas — às vezes um segundo, às vezes o tempo suficiente para duvidares se tinhas marcado o número errado. Depois, a página montava-se: quarenta caracteres de largura, vinte e quatro linhas de altura, em oito cores e mais nada. A página 100 era o índice. A 888 eram as legendas. A meteorologia andava algures nas 400 e a lotaria estava onde o canal a tivesse posto, e aprendias os números como se aprende um número de telefone.',
          ],
          [
            'Era uma pequena «proto-internet» pública e lenta a viver dentro da televisão, gratuita, e presente em todas as casas. Interessa-me porque guarda uma certa ideia de esfera pública: informação como infraestrutura, leve por desenho, disponível a toda a gente ao mesmo tempo, devida às pessoas em vez de vendida. Foi também uma das tecnologias de acessibilidade mais importantes que a televisão teve, tornando o meio utilizável para pessoas surdas e com perda auditiva através de legendas e serviços de texto. E teve uma vida social que ninguém planeou: alguns serviços tinham páginas de conversa onde mensagens SMS apareciam no ecrã para toda a gente. Para algumas pessoas (sobretudo pessoas queer) essas páginas foram espaços raros e semi-anónimos.',
          ],
        ],
      },
      archive: {
        heading: 'o arquivo',
        paragraphs: [
          [
            'Isto não é um arquivo completo, e não podia ser. O teletexto foi feito para ser escrito por cima e quase nada foi guardado. O que está aqui reunido é o que um robô da web apanhou nos dias em que calhou passar, quando os canais portugueses espelhavam os seus serviços de teletexto online. Os canais iam reaproveitando os números das páginas, por isso um mesmo número pode guardar páginas sem relação nenhuma, de épocas diferentes.',
          ],
        ],
      },
      takingPart: {
        heading: 'participar',
        paragraphs: [
          [
            'Podes ver sozinho: marcas uma página, segues os atalhos coloridos, procuras em todas as páginas pelo que está escrito nelas. Ou podes abrir uma sala. Toda a gente na sala vê a mesma página ao mesmo tempo e conversa à margem, e ninguém fica com o comando. Mudar de página é um pedido que fica de pé sessenta segundos e precisa da maioria das pessoas presentes. Esperas, em conjunto, que a página chegue, como no tempo do teletexto. Ler teletexto era uma coisa que se fazia numa sala, em voz alta, com quem lá estivesse. Quase tudo o que construímos para a web é feito para ser usado sozinho e depressa. Isto é uma tentativa do contrário.',
          ],
          [
            'As páginas antigas não são o site todo. Qualquer pessoa pode abrir o editor e fazer uma página sob as limitações do teletexto: quarenta por vinte e quatro, oito cores, altura dupla e texto intermitente, gráficos de mosaico desenhados dividindo cada célula de caractere em seis blocos. As páginas a partir da 700 estão abertas a toda a gente, e uma página a ser editada muda ao vivo no ecrã de quem a estiver a ver. A limitação é o que interessa.',
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
        { text: 'João Bernardo Narciso', href: AUTHOR },
        ' built on the Portuguese teletext archive. It gathers a few thousand pages recovered from the web archive ',
        { text: 'Arquivo.pt', href: ARQUIVO },
        ' including news, weather, football, lottery, classifieds, horoscopes, and SMS services, and puts them back on a screen. They can be watched alone, or in a room with other people, where the group decides together which page to load next and waits for it to arrive. Alongside the archive there is an editor, and anyone can make a new page in the same grid the broadcasters had. The work lives in the space between those two halves: a slow, collective way of looking at something that is mostly lost, and a set of old constraints handed back to whoever wants to be creative and make something new inside them.',
      ],
    ],
    sections: {
      teletext: {
        heading: 'teletext',
        paragraphs: [
          [
            "For a few decades the television signal carried a text service in its unused lines. You pressed TXT on the remote, typed three digits, and waited, sometimes a second, sometimes long enough to wonder if you'd typed the wrong number. Then, the page assembled itself: forty characters wide, twenty-four rows deep, in eight colours and nothing else. Page 100 was the index. Page 888 was subtitles. The weather was somewhere in the 400s and the lottery was wherever the channel had put it, and you learned the numbers the way you learn a phone number.",
          ],
          [
            'It was a small, slow, public "proto-internet" living inside the television, free, and present in every house. I\'m interested in it because it holds a particular idea of the public sphere: information as infrastructure, lightweight by design, available to everyone at once, owed to you rather than sold to you. It was also one of the most important accessibility technologies television ever had, making the medium usable for deaf and hard-of-hearing viewers through subtitles and text services. And it had a social life nobody planned for, as some services ran chat pages where SMS messages appeared on screen for everyone. For some people (queer people especially) those pages were rare, semi-anonymous spaces.',
          ],
        ],
      },
      archive: {
        heading: 'the archive',
        paragraphs: [
          [
            "This is not a complete archive, and it couldn't be. Teletext was designed to be overwritten and almost none of it was kept. What is collected here is what a web crawler happened to catch on the days it happened to run, when Portuguese broadcasters mirrored their teletext services online. Broadcasters reused page numbers as they went, so a single number can hold unrelated pages from unrelated eras.",
          ],
        ],
      },
      takingPart: {
        heading: 'taking part',
        paragraphs: [
          [
            "You can watch on your own: dial a page, follow the coloured links, search every page by what's written on it. Or you can open a room. Everyone in the room sees the same page at the same moment and talks in the margin, and nobody holds the remote. Changing the page is a request that stands for sixty seconds and needs a majority of the people present. You wait, together, for a page to arrive, like in the old teletext days. Reading teletext was something you did in a room, out loud, with whoever else was there. Most of what we build for the web is designed to be used alone and at speed. This is an attempt at the other thing.",
          ],
          [
            "The old pages aren't the whole site. Anyone can open the editor and make a page under teletext constraints: forty by twenty-four, eight colours, double height and blinking text, mosaic graphics drawn by splitting each character cell into six blocks. Pages 700 and up are open to everyone, and a page being edited changes live on the screens of anyone watching it. The constraint is the point.",
          ],
        ],
      },
    },
  },
};
