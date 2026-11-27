export type WebApiLibraryType = "user" | "group";

export interface WebApiLink {
  readonly href: string;
  readonly type: string;
}

export type WebApiLinks = Readonly<Record<string, WebApiLink>>;

export interface WebApiLibrary {
  readonly type: WebApiLibraryType;
  readonly id: number;
  readonly name: string;
  readonly links?: WebApiLinks;
}

export interface WebApiUser {
  readonly id: number;
  readonly username: string;
  readonly name: string;
  readonly links?: WebApiLinks;
}

export interface WebApiObject<Data, Meta = Readonly<Record<string, unknown>>> {
  readonly key: string;
  readonly version: number;
  readonly library: WebApiLibrary;
  readonly links?: WebApiLinks;
  readonly meta?: Meta;
  readonly data: Data;
}

export type WebApiCreator =
  | {
      readonly creatorType: string;
      readonly firstName?: string;
      readonly lastName: string;
    }
  | { readonly creatorType: string; readonly name: string };

export interface WebApiTag {
  readonly tag: string;
  readonly type?: 0 | 1;
}

export type WebApiRelations = Readonly<
  Record<string, string | readonly string[]>
>;

export type WebApiLinkMode =
  | "imported_file"
  | "imported_url"
  | "linked_file"
  | "linked_url"
  | "embedded_image";

export type WebApiAnnotationType =
  | "highlight"
  | "note"
  | "image"
  | "ink"
  | "underline"
  | "text";

export interface WebApiItemData {
  readonly key: string;
  readonly version: number;
  readonly itemType: string;
  readonly parentItem?: string | false;
  readonly creators?: readonly WebApiCreator[];
  readonly tags?: readonly WebApiTag[];
  readonly collections?: readonly string[];
  readonly relations?: WebApiRelations;
  readonly dateAdded?: string;
  readonly dateModified?: string;
  readonly deleted?: boolean | 0 | 1;
  readonly inPublications?: boolean;
  readonly note?: string;
  readonly linkMode?: WebApiLinkMode;
  readonly contentType?: string;
  readonly charset?: string;
  readonly filename?: string;
  readonly path?: string;
  readonly md5?: string | null;
  readonly mtime?: number | null;
  readonly lastRead?: number;
  readonly annotationType?: WebApiAnnotationType;
  readonly annotationAuthorName?: string;
  readonly annotationText?: string;
  readonly annotationComment?: string;
  readonly annotationColor?: string;
  readonly annotationPageLabel?: string;
  readonly annotationSortIndex?: string;
  readonly annotationPosition?: string;
  readonly [field: string]: unknown;
}

export interface WebApiItemMeta {
  readonly createdByUser?: WebApiUser;
  readonly lastModifiedByUser?: WebApiUser;
  readonly creatorSummary?: string;
  readonly parsedDate?: string;
  readonly numChildren?: number;
}

export type WebApiItem = WebApiObject<WebApiItemData, WebApiItemMeta>;

export interface WebApiCollectionData {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly parentCollection: string | false;
  readonly relations?: WebApiRelations;
  readonly deleted?: boolean | 0 | 1;
}

export interface WebApiCollectionMeta {
  readonly numCollections?: number;
  readonly numItems?: number;
}

export type WebApiCollection = WebApiObject<
  WebApiCollectionData,
  WebApiCollectionMeta
>;

export interface WebApiDeleted {
  readonly collections: readonly string[];
  readonly items: readonly string[];
  readonly searches: readonly string[];
  readonly tags: readonly string[];
  readonly settings?: readonly string[];
}

export interface WebApiGroupData {
  readonly id: number;
  readonly version: number;
  readonly name: string;
  readonly owner: number;
  readonly type: string;
  readonly description: string;
  readonly url: string;
  readonly libraryEditing: string;
  readonly libraryReading: string;
  readonly fileEditing: string;
  readonly admins?: readonly number[];
  readonly members?: readonly number[];
}

export interface WebApiGroup {
  readonly id: number;
  readonly version: number;
  readonly links?: WebApiLinks;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly data: WebApiGroupData;
}

export interface WebApiKey {
  readonly userID: number;
  readonly username: string;
  readonly displayName?: string;
  readonly access: {
    readonly user?: {
      readonly library?: boolean;
      readonly notes?: boolean;
      readonly files?: boolean;
      readonly write?: boolean;
    };
    readonly groups?: Readonly<
      Record<string, { readonly library?: boolean; readonly write?: boolean }>
    >;
  };
}
