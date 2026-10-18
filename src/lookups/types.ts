import type { AuditResponse, DependencyRef, PackageMeta, RegistryVersions } from '../types';

/** An ecosystem adapter supplies metadata without deciding update policy. */
export interface Lookup {
  availabilitySource?(dep: DependencyRef): string;
  fetchAvailability?(dep: DependencyRef, known: RegistryVersions): Promise<RegistryVersions>;
  key(dep: DependencyRef): string;
  fetch(dep: DependencyRef): Promise<RegistryVersions>;
  fetchAll?(dep: DependencyRef): Promise<RegistryVersions>;
  fetchAudit?(dep: DependencyRef, version: string): Promise<AuditResponse>;
  fetchDetails?(dep: DependencyRef, versions: VersionPair): Promise<PackageDetails>;
}

/** Versions shown in a hint, spelled the way their registry spells them. */
export interface VersionPair {
  current: string;
  latest: string;
  sameMajor?: string;
}

/** Optional metadata fetched only when a user hovers over a declaration. */
export interface PackageDetails {
  links?: import('../packageLinks').PackageLink[];
  currentPublishedAt?: string;
  latestPublishedAt?: string;
  sameMajorPublishedAt?: string;
  meta?: PackageMeta;
}
