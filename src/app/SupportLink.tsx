import { MessageCircle } from 'lucide-react';
import type { JSX } from 'react';
import { whatsAppChatUrl } from '@/domain/whatsapp';
import { SUPPORT_WHATSAPP, type SupportTopic } from './support';

export type SupportLinkProps = {
  topic: SupportTopic;
  /** The seller's number; this build's by default. */
  number?: string | null;
  /** Take the colour of the text around it, as on a warning band. */
  inheritColor?: boolean;
};

/**
 * A WhatsApp chat with the seller, the message already written. A build without the seller's
 * number says whom to contact instead, so nothing dead is offered.
 */
export function SupportLink({
  topic,
  number = SUPPORT_WHATSAPP,
  inheritColor = false,
}: SupportLinkProps): JSX.Element {
  if (!number) {
    return <p className={`text-sm ${inheritColor ? '' : 'text-text-2'}`}>{topic.fallback}</p>;
  }
  return (
    <a
      href={whatsAppChatUrl(number, topic.message)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center gap-2 self-start text-sm font-semibold underline-offset-4 hover:underline ${
        inheritColor ? 'underline' : 'text-accent'
      }`}
    >
      <MessageCircle aria-hidden="true" size={18} strokeWidth={1.75} />
      {topic.label}
    </a>
  );
}
