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
  certificateEnabled: boolean;
  checkpoints: CheckpointView[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
