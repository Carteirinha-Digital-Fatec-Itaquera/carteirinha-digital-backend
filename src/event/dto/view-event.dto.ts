import {
  CheckpointView,
  EventStatus,
  EventView,
  IsoDateTime,
  Uuid,
} from '../../contracts/v1-events.types';

export class ViewEventDto implements EventView {
  id: Uuid;
  title: string;
  description: string | null;
  speaker: string;
  location: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  workloadMinutes: number;
  status: EventStatus;
  cancelReason: string | null;
  cancelledAt: IsoDateTime | null;
  cancelledById: number | null;
  certificateEnabled: boolean;
  visitorsAllowed?: boolean;
  organizerCourse?: string | null;
  promoter?: string | null;
  geoPolicy?: unknown | null;
  certificatePolicies?: unknown | null;
  seriesId?: string | null;
  series?: {
    id: string;
    title: string;
    slug: string;
    isAutomatic?: boolean;
    courses?: string[];
  } | null;
  checkpoints: CheckpointView[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
