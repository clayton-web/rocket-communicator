import { describe, expect, it } from 'vitest';
import {
  deliveryExplanationCopy,
  predictDeliveryPathFromSourceType,
} from '@/lib/handoff/client/delivery-copy';

describe('A7.8 delivery copy prediction', () => {
  it('predicts gmail_forward only for gmail sourceType', () => {
    expect(predictDeliveryPathFromSourceType('gmail')).toBe('gmail_forward');
    expect(predictDeliveryPathFromSourceType('manual')).toBe('assignment_email');
    expect(predictDeliveryPathFromSourceType(undefined)).toBe('assignment_email');
  });

  it('uses approved explanatory wording without promising delivery', () => {
    const gmail = deliveryExplanationCopy('gmail_forward');
    expect(gmail).toContain('available attachments');
    expect(gmail).toContain('secure action link');
    expect(gmail.toLowerCase()).not.toContain('will definitely');

    const assignment = deliveryExplanationCopy('assignment_email');
    expect(assignment).toContain('assignment email');
    expect(assignment).toContain('secure action link');
  });
});
