import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  AiOrchestratorService,
  type ImportFilterSpec,
} from '../ai/ai-orchestrator.service';
import { InterpretFilterDto } from './dto/interpret-filter.dto';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(private ai: AiOrchestratorService) {}

  /** Interpret a plain-language context/instruction into a structured filter. */
  async interpretFilter(dto: InterpretFilterDto): Promise<ImportFilterSpec> {
    if (!dto.instruction.trim()) {
      return { match: 'all', conditions: [] };
    }
    return this.ai.interpretImportFilter(
      dto.columns,
      dto.sampleRows,
      dto.instruction,
    );
  }

  /**
   * Build the CSV-export URL for a Google Sheet. We extract and validate the
   * spreadsheet id + gid from the user's link and construct the URL ourselves —
   * the server only ever fetches docs.google.com, never the raw input (no SSRF).
   */
  private toExportUrl(url: string): string {
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      throw new BadRequestException(
        'That doesn’t look like a Google Sheets link.',
      );
    }
    const id = idMatch[1];
    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }

  async fetchGoogleSheet(url: string): Promise<{ csv: string }> {
    const exportUrl = this.toExportUrl(url);

    try {
      const res = await axios.get<string>(exportUrl, {
        responseType: 'text',
        timeout: 15000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'QuerySense/1.0' },
      });

      const contentType = String(res.headers['content-type'] ?? '');
      // A non-public sheet redirects to an HTML login page instead of CSV.
      if (!contentType.includes('text/csv')) {
        throw new BadRequestException(
          'Could not read the sheet as CSV. Share it as “Anyone with the link → Viewer” and try again.',
        );
      }

      const csv = typeof res.data === 'string' ? res.data : String(res.data);
      if (!csv.trim()) {
        throw new BadRequestException('That sheet appears to be empty.');
      }
      return { csv };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(
        `Google Sheet fetch failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw new BadRequestException(
        'Could not fetch that Google Sheet. Check the link and that it’s shared publicly (Anyone with the link → Viewer).',
      );
    }
  }
}
