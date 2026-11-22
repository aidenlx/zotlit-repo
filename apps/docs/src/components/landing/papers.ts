export interface Paper {
  citekey: string;
  title: string;
  short: string;
  creators: string;
  year: number;
  venue: string;
  rating: number;
  children: boolean;
  pdf: boolean;
  note: boolean;
}

export const COLLECTION_PAPERS: readonly Paper[] = [
  {
    citekey: "munafo2017",
    title: "A manifesto for reproducible science",
    short: "Munafò, Nosek, Bishop et al.",
    creators: "Marcus R. Munafò, Brian A. Nosek, Dorothy V. M. Bishop, …",
    year: 2017,
    venue: "Nature Human Behaviour",
    rating: 4,
    children: false,
    pdf: false,
    note: false,
  },
  {
    citekey: "wilson2014",
    title: "Best Practices for Scientific Computing",
    short: "Wilson, Aruliah, Brown et al.",
    creators:
      "Greg Wilson, D. A. Aruliah, C. Titus Brown, Neil P. Chue Hong, …",
    year: 2014,
    venue: "PLOS Biology",
    rating: 3,
    children: true,
    pdf: true,
    note: false,
  },
  {
    citekey: "sandve2013",
    title: "Ten Simple Rules for Reproducible Computational Research",
    short: "Sandve, Nekrutenko, Taylor et al.",
    creators:
      "Geir Kjetil Sandve, Anton Nekrutenko, James Taylor, Eivind Hovig",
    year: 2013,
    venue: "PLOS Computational Biology",
    rating: 5,
    children: true,
    pdf: true,
    note: true,
  },
  {
    citekey: "ioannidis2005",
    title: "Why Most Published Research Findings Are False",
    short: "Ioannidis",
    creators: "John P. A. Ioannidis",
    year: 2005,
    venue: "PLoS Medicine",
    rating: 5,
    children: true,
    pdf: true,
    note: true,
  },
];

export const BY_YEAR: readonly Paper[] = [...COLLECTION_PAPERS].sort(
  (a, b) => a.year - b.year,
);

export const COLLECTION = "Reproducibility";
export const QUERY_FOLDER = "Thesis";
export const QUERY_FILE = `${QUERY_FOLDER}/${COLLECTION}.zotquery`;
export const TAGS = [
  "methodology",
  "reproducibility",
  "research-practice",
  "visualization",
];
