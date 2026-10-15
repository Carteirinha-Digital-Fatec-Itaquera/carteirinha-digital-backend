import { Module } from '@nestjs/common';
import { EventStorageService } from './event-storage.service';
@Module({ providers: [EventStorageService], exports: [EventStorageService] })
export class EventAssetsModule {}
