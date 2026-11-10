import { defineEpisode, Timeline } from '../../engine';
import timeline from './timeline.json';
import * as Q from './shots';

// The episode: its timeline (written by scripts/plan.py) plus one component per shot.
const ids = ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12',
  'S13','S14','S15','S16','S17','S18','S19','S20','S21','S22','S23','S24',
  'S25','S26','S27','S28','S29','S30','S31','S32','S33','S34','S35','S36'];
const shots = Object.fromEntries(ids.map((id) => [id, (Q as Record<string, unknown>)[id]]));

export const telephoneSalon = defineEpisode('TelephoneSalon', {
  timeline: timeline as Timeline,
  shots: shots as Parameters<typeof defineEpisode>[1]['shots'],
});
