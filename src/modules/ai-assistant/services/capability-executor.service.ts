import { Injectable, Logger } from '@nestjs/common';
import { AiCapabilitiesService } from '../capabilities/ai-capabilities.service';
import { ToolSession } from '../capabilities/tool-session';
import {
  ToolArgsError,
  optionalString,
  parseArgsObject,
  requiredString,
  requiredUuid,
} from '../capabilities/tool-args';
import { TOOL } from '../config/ai-tools.config';


@Injectable()
export class CapabilityExecutorService {
  private readonly logger = new Logger(CapabilityExecutorService.name);

  constructor(private readonly capabilities: AiCapabilitiesService) { }

  async executeTool(toolName: string, rawArgs: unknown, session: ToolSession): Promise<unknown> {
    const args = parseArgsObject(rawArgs);
    const result = await this.dispatch(toolName, args, session);

    this.logger.log(`Tool ${toolName}(${Object.keys(args).join(',')}) -> ${this.summarize(result)}`);
    return result;
  }

  private async dispatch(toolName: string, args: Record<string, unknown>, session: ToolSession): Promise<unknown> {
    try {
      switch (toolName) {
        case TOOL.LIST_SPECIALTIES:
          return await this.capabilities.listSpecialties();

        case TOOL.SUGGEST_SPECIALTY:
          return await this.capabilities.suggestSpecialty(
            { specialty: requiredString(args, 'specialty') },
            session,
          );

        case TOOL.SEARCH_DOCTORS:
          return await this.capabilities.searchDoctors(
            {
              specialty: optionalString(args, 'specialty'),
              name: optionalString(args, 'name'),
            },
            session,
          );

        case TOOL.GET_AVAILABILITY:
          return await this.capabilities.getAvailability({ doctorId: requiredUuid(args, 'doctorId') }, session);

        case TOOL.GET_MY_APPOINTMENTS:
          return await this.capabilities.getMyAppointments(session);

        case TOOL.GET_POLICY:
          return this.capabilities.getPolicy({ topic: requiredString(args, 'topic', 40) });

        default:
          this.logger.warn(`Unknown tool requested: ${toolName}`);
          return { error: 'UNKNOWN_TOOL' };
      }
    } catch (error) {
      if (error instanceof ToolArgsError) {
        return { error: 'INVALID_ARGUMENTS', field: error.field };
      }
      this.logger.error(`Tool ${toolName} crashed: ${(error as Error)?.message}`);
      return { error: 'TEMPORARILY_UNAVAILABLE' };
    }
  }

  private summarize(result: unknown): string {
    const r = result as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return 'ok';
    if (r.error) return `error=${String(r.error)}${r.field ? `(${String(r.field)})` : ''}`;
    if (r.reason) return `reason=${String(r.reason)}`;
    if (r.requiresAuth) return 'requiresAuth';
    if (r.found === false) return 'found=false';
    if (Array.isArray(r.doctors)) return `doctors=${r.doctors.length}`;
    if (Array.isArray(r.appointments)) return `appointments=${r.appointments.length}`;
    if (Array.isArray(r.specialties)) return `specialties=${r.specialties.length}`;
    if (r.ok === true) return 'ok';
    if (r.found === true) return `found freeSlots=${Array.isArray(r.freeSlots) ? r.freeSlots.length : 'n/a'}`;
    return 'ok';
  }
}