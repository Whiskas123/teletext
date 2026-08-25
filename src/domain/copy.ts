/**
 * Everything the app says, in both languages.
 *
 * `domain/landing.ts` already did this for the front page, and this is the same
 * idea carried across the rest of the visitor's screens: the words are data, in
 * one place, keyed by language, so adding a third one is a column here rather
 * than a hunt through forty components.
 *
 * ## What is not in here
 *
 * **The teletext itself.** The pages are an archive of Portuguese broadcast
 * teletext — RTP and SIC, as transmitted — and translating what a 1994 page said
 * about the weather would make it a different thing entirely. The archive is the
 * artefact; the app around it is the label on the case. Page titles, the
 * directory's own headings and every cell of every page are therefore untouched
 * and always will be.
 *
 * **`/moderator`, `/manage`, `/import`.** Three admin screens with one operator,
 * who speaks the language they are written in. Translating them would double the
 * surface for nobody.
 *
 * ## Shape
 *
 * Grouped by the thing that says it rather than by screen, because several of
 * them appear on more than one: the directory is a leaflet on both watching
 * screens, the television is on both, and the vote console is only in a room but
 * reads out numbers the set also shows. Anything with a value in it is a
 * function, so word order is the translation's to decide — Portuguese does not
 * put the count where English does, and a template assembled at the call site
 * would take that choice away.
 */

import type { Language } from './landing';

export interface Copy {
  /** The shell every watching screen sits in. */
  layout: {
    backHome: string;
    room: string;
    panels: string;
  };
  /** The one thing the connection indicator ever has to say. */
  connection: {
    disconnected: string;
  };
  /** Who else is here, in the head of the chat console. */
  presence: {
    region: string;
    heading: string;
    count(n: number): string;
    none: string;
    rename: string;
    yourName: string;
    /** Marks your own name in the roster, brackets included. */
    you: string;
    save: string;
    invalidName: string;
  };
  /** The chat console. */
  chat: {
    name: string;
    region: string;
    log: string;
    empty: string;
    placeholder: string;
    messageLabel: string;
    send: string;
    errorEmpty: string;
    errorTooLong: string;
    /** Spoken for the lamp on the phone's chat tab. */
    unread: string;
  };
  /** The vote console: its readouts, its keys, and everything it refuses. */
  vote: {
    name: string;
    region: string;
    /** Engraved under the three readouts. Kept short — they are engravings. */
    capPage: string;
    capFor: string;
    capAgainst: string;
    accept: string;
    reject: string;
    request: string;
    askForPage: string;
    needed(threshold: number, base: number): string;
    carried: string;
    notCarried: string;
    noVote: string;
    /** Spoken for the lamp on the phone's vote tab. */
    inProgress: string;
    refused: string;
    /** Read aloud in place of a plate full of `<rect>`s. */
    spokenLive(page: string, accept: number, reject: number, threshold: number, base: number): string;
    spokenCarried(page: string, accept: number, reject: number): string;
    spokenLost(page: string, accept: number, reject: number): string;
    outOfRange: string;
    activeExists: string;
    alreadyVoted: string;
    ineligible: string;
    notActive: string;
    unableToSubmit: string;
    notRecorded: string;
  };
  /** The directory, as a leaflet and as a book. */
  directory: {
    title: string;
    open: string;
    close: string;
    searchOpen: string;
    searchClose: string;
    searchPlaceholder: string;
    tooShort(min: number): string;
    noResults: string;
    resultsFound(n: number): string;
    noListings: string;
  };
  /** The television, whose every control is spoken but never written. */
  tv: {
    set: string;
    remote: string;
    prevPage: string;
    nextPage: string;
    prevSubpage(subpage: number, count: number): string;
    nextSubpage(subpage: number, count: number): string;
    dial(digit: string): string;
    fastext(label: string, page: number): string;
    switchOff: string;
    switchOn: string;
  };
  /** The editor's own panel. */
  editor: {
    page: string;
    subpage: string;
    subpages: string;
    title: string;
    untitled: string;
    pageSetup: string;
    pageSetupHint: string;
    dialAPage: string;
    prevPage: string;
    nextPage: string;
    prevSubpage(subpage: number, count: number): string;
    nextSubpage(subpage: number, count: number): string;
    addSubpage: string;
    addSubpageHint: string;
    removeSubpage: string;
    removeSubpageHint(last: number): string;
    subpageOneIsThePage: string;
    maxSubpages(max: number): string;
    exportPng: string;
    clearPage: string;
    clearConfirm: string;
    clearYes: string;
    clearNo: string;
    backToGrid: string;
    saving: string;
    notSaving: string;
    notSaved(reason: string): string;
    titleTooLong(max: number): string;
    reservedPages(min: number, max: number): string;
    pagesNumbered(min: number, max: number): string;
    editingPage(page: number, subpage: number, count: number): string;
    recentBrushes: string;
    recentTextStyles: string;
    recent: string;
    tools: string;
    wholePage: string;
    console: string;
    grid: string;
    keyboard: string;
    color: string;
    background: string;
    doubleHeight: string;
    doubleHeightHint: string;
    pickedShape: string;
    fillWholeCell: string;
    pixelColor: string;
    exportKey: string;
    /** The five tool keys: what is printed on the cap, and what the cap does. */
    toolText: string;
    toolTextHint: string;
    toolBlock: string;
    toolBlockHint: string;
    toolPixel: string;
    toolPixelHint: string;
    toolBlink: string;
    toolBlinkHint: string;
    toolPick: string;
    toolPickHint: string;
  };
  /**
   * The guestbook: the book itself, and the form for signing it.
   *
   * "Guestbook" stays in English in both languages. It is the word the thing
   * has always had online, Portuguese included, and `livro de visitas` reads as
   * a hotel reception rather than as the thing this is.
   */
  guestbook: {
    title: string;
    region: string;
    /** One line under the title saying what to do. */
    intro: string;
    /** The list, and what stands in for it while nobody has signed. */
    entries: string;
    empty: string;
    /**
     * What stands in for it while the book is still arriving.
     *
     * Distinct from `empty` on purpose: the shared document takes a moment to
     * sync on a cold load, and saying "nobody has signed yet" during it is a
     * wrong answer rather than a slow one.
     */
    loading: string;
    /** Marks the reader's own signature in the list. */
    yours: string;
    /** How an entry is dated, and named, when read out. */
    signedBy(name: string): string;
    /** Opens the form, and names it once it is open. */
    sign: string;
    /** Closes it again. */
    close: string;
    yourName: string;
    namePlaceholder: string;
    yourSnippet: string;
    /**
     * Said under the grid, per tool. Two strings rather than one that describes
     * both: the hint is read while using one of them, and half of a combined
     * hint would always be about the tool that is not selected.
     */
    textHint: string;
    pixelHint: string;
    tool: string;
    toolText: string;
    toolPixel: string;
    color: string;
    /** Only the text tool has one — see the note in `GuestbookPage`. */
    background: string;
    clear: string;
    submit: string;
    /** What comes back when the book refuses a signature. */
    errorNoName: string;
    errorNameTooLong(max: number): string;
    errorBlank: string;
    /** Said once a signature has landed. */
    signed: string;
  };
  /**
   * The screen for a URL that is not one.
   *
   * It is translated, unlike the admin screens, because unlike them it is not
   * reached on purpose: a mistyped address or a link that has rotted lands
   * whoever followed it here, and they are as likely to be reading Portuguese
   * as anyone else on the site.
   */
  notFound: {
    title: string;
    region: string;
    /** What happened, in one line. */
    message: string;
    /** The two ways out: the front page, and the archive. */
    watch: string;
  };
}

export const COPY: Record<Language, Copy> = {
  pt: {
    layout: {
      backHome: 'Voltar ao início',
      room: 'Sala',
      panels: 'Painéis da sala',
    },
    connection: {
      disconnected: 'Sem ligação — a reconectar…',
    },
    presence: {
      region: 'Quem está a ver',
      heading: 'A ver',
      count: (n) => `(${n})`,
      none: 'Ninguém ligado',
      rename: 'Mudar nome',
      yourName: 'O teu nome',
      you: '(tu)',
      save: 'Guardar',
      invalidName: 'O nome tem de ter entre 1 e 32 caracteres',
    },
    chat: {
      name: 'Chat',
      region: 'Conversa da sala',
      log: 'Mensagens',
      empty: 'Ainda não há mensagens. Diz olá!',
      placeholder: 'Escreve alguma coisa…',
      messageLabel: 'Mensagem',
      send: 'Enviar',
      errorEmpty: 'A mensagem não pode estar vazia',
      errorTooLong: 'A mensagem excede 500 caracteres',
      unread: 'Mensagens novas',
    },
    vote: {
      name: 'Votação',
      region: 'Votação da sala',
      capPage: 'PÁGINA',
      capFor: 'A FAVOR',
      capAgainst: 'CONTRA',
      accept: 'Aceitar',
      reject: 'Rejeitar',
      request: 'Pedir',
      askForPage: 'Pedir uma página',
      needed: (threshold, base) => `Faltam ${threshold} de ${base}`,
      carried: 'Aprovada',
      notCarried: 'Chumbada',
      noVote: 'Nenhuma votação em curso',
      inProgress: 'Votação em curso',
      refused: 'Pedido recusado',
      spokenLive: (page, accept, reject, threshold, base) =>
        `Página ${page}: ${accept} a favor, ${reject} contra, ${threshold} de ${base} necessários`,
      spokenCarried: (page, accept, reject) =>
        `Página ${page} aprovada, ${accept} contra ${reject}`,
      spokenLost: (page, accept, reject) =>
        `Página ${page} chumbada, ${accept} contra ${reject}`,
      outOfRange: 'Escreve um número de página entre 100 e 999',
      activeExists: 'Já há uma votação em curso',
      alreadyVoted: 'Já votaste',
      ineligible: 'Entraste depois de a votação começar e não podes votar',
      notActive: 'Esta votação já terminou',
      unableToSubmit: 'Não foi possível pedir',
      notRecorded: 'Voto não registado',
    },
    directory: {
      title: 'Páginas Amarelas',
      open: 'Abrir as Páginas Amarelas',
      close: 'Fechar as Páginas Amarelas',
      searchOpen: 'Procurar texto nas páginas',
      searchClose: 'Fechar a procura',
      searchPlaceholder: 'Procurar uma palavra em qualquer página…',
      tooShort: (min) => `Escreve pelo menos ${min} letras.`,
      noResults: 'Nada encontrado.',
      resultsFound: (n) => (n === 1 ? '1 resultado' : `${n} resultados`),
      noListings:
        'Ainda não há páginas. Cria uma no editor para aparecer aqui.',
    },
    tv: {
      set: 'Televisor',
      remote: 'Comando',
      prevPage: 'Página anterior',
      nextPage: 'Página seguinte',
      prevSubpage: (subpage, count) =>
        `Subpágina anterior (a mostrar ${subpage} de ${count})`,
      nextSubpage: (subpage, count) =>
        `Subpágina seguinte (a mostrar ${subpage} de ${count})`,
      dial: (digit) => `Marcar ${digit}`,
      fastext: (label, page) => `${label} (página ${page})`,
      switchOff: 'Desligar o televisor',
      switchOn: 'Ligar o televisor',
    },
    editor: {
      page: 'Página',
      subpage: 'Subpágina',
      subpages: 'Subpáginas',
      title: 'Título',
      untitled: 'Página sem título',
      pageSetup: 'Configuração da página',
      pageSetupHint: 'Marcar um número, dar nome à página, juntar ou tirar ecrãs',
      dialAPage: 'Marcar um número de página',
      prevPage: 'Página anterior',
      nextPage: 'Página seguinte',
      prevSubpage: (subpage, count) =>
        `Subpágina anterior (a editar ${subpage} de ${count})`,
      nextSubpage: (subpage, count) =>
        `Subpágina seguinte (a editar ${subpage} de ${count})`,
      addSubpage: '+ Juntar',
      addSubpageHint: 'Juntar uma subpágina vazia no fim e ir para ela',
      removeSubpage: '− Tirar a última',
      removeSubpageHint: (last) => `Apagar a subpágina ${last} e o seu conteúdo`,
      subpageOneIsThePage: 'A subpágina 1 é a própria página.',
      maxSubpages: (max) => `Uma página tem no máximo ${max} subpáginas.`,
      exportPng: 'Exportar esta página como PNG',
      clearPage: 'Limpar a página inteira',
      clearConfirm: 'Limpar a página inteira?',
      clearYes: 'Limpar',
      clearNo: 'Cancelar',
      backToGrid: 'Voltar à grelha',
      saving: 'A guardar',
      notSaving: 'Não está a guardar',
      notSaved: (reason) => `Alteração não guardada: ${reason}`,
      titleTooLong: (max) => `O título tem de ter ${max} caracteres ou menos.`,
      reservedPages: (min, max) => `As páginas ${min}–${max} estão reservadas.`,
      pagesNumbered: (min, max) => `As páginas vão de ${min} a ${max}.`,
      editingPage: (page, subpage, count) =>
        `A editar a página ${page}, subpágina ${subpage} de ${count}. Escreve três dígitos para abrir outra página.`,
      recentBrushes: 'Pincéis recentes',
      recentTextStyles: 'Estilos recentes',
      recent: 'Recentes',
      tools: 'Ferramentas',
      wholePage: 'Página inteira',
      console: 'Consola',
      grid: 'Grelha de edição de teletexto',
      keyboard: 'Teclado',
      color: 'Cor',
      background: 'Fundo',
      doubleHeight: 'Altura dupla',
      doubleHeightHint:
        'Os caracteres escritos ficam com o dobro da altura. Não funciona na última linha.',
      pickedShape: 'Forma copiada',
      fillWholeCell: 'Encher a célula toda',
      pixelColor: 'Cor do pixel',
      exportKey: 'Exportar PNG',
      toolText: 'Texto',
      toolTextHint: 'Escrever texto',
      toolBlock: 'Bloco',
      toolBlockHint: 'Pintar células de mosaico inteiras com um motivo',
      toolPixel: 'Pixel',
      toolPixelHint: 'Pintar um sexto de uma célula. Alt+clique para apagar.',
      toolBlink: 'Piscar',
      toolBlinkHint: 'Pôr as células a piscar. Alt+clique para tirar.',
      toolPick: 'Copiar',
      toolPickHint:
        'Clica numa célula para copiar o que a fez: as cores se tiver um caractere, a forma e as cores se for um mosaico.',
    },
    guestbook: {
      title: 'guestbook',
      region: 'Guestbook',
      intro: 'Deixa o teu nome e oito linhas de teletexto.',
      entries: 'Assinaturas',
      empty: 'Ainda ninguém assinou. Podes ser a primeira pessoa.',
      loading: 'A carregar as assinaturas…',
      yours: 'a tua',
      signedBy: (name) => `Assinado por ${name}`,
      sign: 'Assinar',
      close: 'Fechar',
      yourName: 'O teu nome',
      namePlaceholder: '',
      yourSnippet: 'A tua página',
      textHint: 'Clica numa célula e escreve. As setas movem o cursor.',
      pixelHint:
        'Arrasta para pintar.',
      tool: 'Ferramenta',
      toolText: 'Texto',
      toolPixel: 'Pixel',
      color: 'Cor',
      background: 'Fundo',
      clear: 'Limpar',
      submit: 'Assinar',
      errorNoName: 'Escreve um nome.',
      errorNameTooLong: (max) => `O nome tem de ter ${max} caracteres ou menos.`,
      errorBlank: 'A página está vazia. Escreve ou desenha alguma coisa.',
      signed: 'Assinado. Obrigado.',
    },
    notFound: {
      title: 'página não encontrada',
      region: 'Página não encontrada',
      message: 'Este endereço não existe. Talvez tenha mudado, ou tenha sido mal escrito.',
      watch: 'Ver teletexto',
    },
  },
  en: {
    layout: {
      backHome: 'Back to home',
      room: 'Room',
      panels: 'Room panels',
    },
    connection: {
      disconnected: 'Disconnected — reconnecting…',
    },
    presence: {
      region: 'Viewers present',
      heading: 'Viewers',
      count: (n) => `(${n})`,
      none: 'No members online',
      rename: 'Rename',
      yourName: 'Your name',
      you: '(you)',
      save: 'Save',
      invalidName: 'Display name must be between 1 and 32 characters',
    },
    chat: {
      name: 'Chat',
      region: 'Room chat',
      log: 'Chat messages',
      empty: 'No messages yet. Say hello!',
      placeholder: 'Say something…',
      messageLabel: 'Message',
      send: 'Send',
      errorEmpty: 'Message cannot be empty',
      errorTooLong: 'Message exceeds 500 characters',
      unread: 'New messages',
    },
    vote: {
      name: 'Vote',
      region: 'Room vote',
      capPage: 'PAGE',
      capFor: 'FOR',
      capAgainst: 'AGAINST',
      accept: 'Accept',
      reject: 'Reject',
      request: 'Request',
      askForPage: 'Ask for a page',
      needed: (threshold, base) => `Needed ${threshold} of ${base}`,
      carried: 'Carried',
      notCarried: 'Not carried',
      noVote: 'No vote in progress',
      inProgress: 'Vote in progress',
      refused: 'Request refused',
      spokenLive: (page, accept, reject, threshold, base) =>
        `Page ${page}: ${accept} in favour, ${reject} against, ${threshold} of ${base} needed`,
      spokenCarried: (page, accept, reject) =>
        `Page ${page} carried, ${accept} to ${reject}`,
      spokenLost: (page, accept, reject) =>
        `Page ${page} not carried, ${accept} to ${reject}`,
      outOfRange: 'Enter a page number between 100 and 999',
      activeExists: 'A vote is already in progress',
      alreadyVoted: 'You have already voted',
      ineligible: 'You joined after this vote started and cannot vote',
      notActive: 'This vote is no longer active',
      unableToSubmit: 'Unable to submit',
      notRecorded: 'Vote not recorded',
    },
    directory: {
      title: 'Yellow Pages',
      open: 'Open Yellow Pages',
      close: 'Close Yellow Pages',
      searchOpen: 'Search pages by text',
      searchClose: 'Close search',
      searchPlaceholder: 'Find a word on any page…',
      tooShort: (min) => `Type at least ${min} letters.`,
      noResults: 'Nothing found.',
      resultsFound: (n) => (n === 1 ? '1 result' : `${n} results`),
      noListings:
        'No listings yet. Create a page in the editor to have it appear here.',
    },
    tv: {
      set: 'Television set',
      remote: 'Remote control',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      prevSubpage: (subpage, count) =>
        `Previous subpage (showing ${subpage} of ${count})`,
      nextSubpage: (subpage, count) =>
        `Next subpage (showing ${subpage} of ${count})`,
      dial: (digit) => `Dial ${digit}`,
      fastext: (label, page) => `${label} (page ${page})`,
      switchOff: 'Switch the television off',
      switchOn: 'Switch the television on',
    },
    editor: {
      page: 'Page',
      subpage: 'Subpage',
      subpages: 'Subpages',
      title: 'Title',
      untitled: 'Untitled page',
      pageSetup: 'Page setup',
      pageSetupHint: 'Dial a page number, name the page, add or remove screens',
      dialAPage: 'Dial a page number',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      prevSubpage: (subpage, count) =>
        `Previous subpage (editing ${subpage} of ${count})`,
      nextSubpage: (subpage, count) =>
        `Next subpage (editing ${subpage} of ${count})`,
      addSubpage: '+ Add',
      addSubpageHint: 'Add an empty subpage at the end and go to it',
      removeSubpage: '− Remove last',
      removeSubpageHint: (last) => `Delete subpage ${last} and its content`,
      subpageOneIsThePage: 'Subpage 1 is the page itself.',
      maxSubpages: (max) => `A page holds at most ${max} subpages.`,
      exportPng: 'Export this page as a PNG',
      clearPage: 'Clear the whole page',
      clearConfirm: 'Clear the whole page?',
      clearYes: 'Clear',
      clearNo: 'Cancel',
      backToGrid: 'Back to grid',
      saving: 'Saving',
      notSaving: 'Not saving',
      notSaved: (reason) => `Change not saved: ${reason}`,
      titleTooLong: (max) => `Title must be ${max} characters or fewer.`,
      reservedPages: (min, max) => `Pages ${min}–${max} are reserved.`,
      pagesNumbered: (min, max) => `Pages are numbered ${min}–${max}.`,
      editingPage: (page, subpage, count) =>
        `Editing page ${page}, subpage ${subpage} of ${count}. Type three digits to open another page.`,
      recentBrushes: 'Recent brushes',
      recentTextStyles: 'Recent text styles',
      recent: 'Recent',
      tools: 'Tools',
      wholePage: 'Whole page',
      console: 'Console',
      grid: 'Teletext editor grid',
      keyboard: 'Keyboard',
      color: 'Color',
      background: 'Background',
      doubleHeight: 'Double height',
      doubleHeightHint:
        'Typed characters render at twice the row height. Not available on the last row.',
      pickedShape: 'Picked shape',
      fillWholeCell: 'Fill the whole cell',
      pixelColor: 'Pixel color',
      exportKey: 'Export PNG',
      toolText: 'Text',
      toolTextHint: 'Type text',
      toolBlock: 'Block',
      toolBlockHint: 'Paint whole mosaic cells with a motif',
      toolPixel: 'Pixel',
      toolPixelHint: 'Paint a single sixth of a cell. Alt+click to erase it.',
      toolBlink: 'Blink',
      toolBlinkHint: 'Paint blink on cells. Alt+click to remove blink.',
      toolPick: 'Pick',
      toolPickHint:
        'Click a cell to copy what made it: its colours if it holds a character, its shape and colours if it is a mosaic.',
    },
    guestbook: {
      title: 'guestbook',
      region: 'Guestbook',
      intro: 'Leave your name and eight rows of teletext.',
      entries: 'Signatures',
      empty: 'Nobody has signed yet. You could be first.',
      loading: 'Loading the signatures…',
      yours: 'yours',
      signedBy: (name) => `Signed by ${name}`,
      sign: 'Sign the book',
      close: 'Close',
      yourName: 'Your name',
      namePlaceholder: '',
      yourSnippet: 'Your page',
      textHint: 'Click a cell and type. The arrow keys move the cursor.',
      pixelHint: 'Drag to paint.',
      tool: 'Tool',
      toolText: 'Text',
      toolPixel: 'Pixel',
      color: 'Colour',
      background: 'Background',
      clear: 'Clear',
      submit: 'Sign',
      errorNoName: 'Enter a name.',
      errorNameTooLong: (max) => `A name must be ${max} characters or fewer.`,
      errorBlank: 'The page is empty. Write or draw something on it.',
      signed: 'Signed. Thank you.',
    },
    notFound: {
      title: 'page not found',
      region: 'Page not found',
      message: 'There is nothing at this address. It may have moved, or been mistyped.',
      watch: 'Watch teletext',
    },
  },
};
