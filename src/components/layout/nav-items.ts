import {
  AudioLines,
  BarChart3,
  Bot,
  Contact,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  PhoneIncoming,
  PhoneOutgoing,
  Plug,
  Settings,
  Smartphone,
} from 'lucide-react';

export const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/inbound', label: 'Inbound Calls', icon: PhoneIncoming },
  { href: '/outbound', label: 'Outbound Calls', icon: PhoneOutgoing },
  { href: '/campaigns', label: 'Bulk Campaigns', icon: Megaphone },
  { href: '/calls', label: 'Call Logs', icon: ListChecks },
  { href: '/recordings', label: 'Recordings', icon: AudioLines },
  { href: '/contacts', label: 'Contacts', icon: Contact },
  { href: '/phone-numbers', label: 'Phone Numbers', icon: Smartphone },
  { href: '/voice-agents', label: 'Voice Agents', icon: Bot },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;
