/**
 * Page descriptions, stored beside titles in the live document.
 *
 * A description used to exist only on a publication record, which meant only
 * archive pages could have one — and the management screen now covers every
 * page on air, including the ones people made by hand. Keeping descriptions in
 * playhtml puts them where titles already are, so the same page has the same
 * kind of metadata however it came to exist.
 *
 * The publication record keeps its own copy as provenance: what the page was
 * published with, as opposed to what it says now.
 */

/** Descriptions keyed by page number. */
export type DescriptionsData = Record<number, string>;

/** Stable playhtml channel id for the map of page descriptions. */
export const DESCRIPTIONS_CHANNEL = 'descriptions';

/** Longest description kept, matching the publication record's limit. */
export const MAX_PAGE_DESCRIPTION = 500;
