import { Skeleton } from '../components/Skeleton';

/** Hueco con la forma del encabezado, para que la pantalla no salte al llegar el perfil. */
export function ProfileSkeleton({ label }: { label: string }) {
  return <div aria-busy="true">
    <span className="sr-only" role="status">{label}</span>
    <div className="profile-hero profile-skeleton" aria-hidden="true">
      <Skeleton variant="box" height={172} />
      <div className="profile-skeleton-body"><Skeleton variant="circle" width={92} height={92} /><Skeleton variant="title" width="55%" /><Skeleton width="35%" /><Skeleton variant="box" height={64} /></div>
    </div>
  </div>;
}
