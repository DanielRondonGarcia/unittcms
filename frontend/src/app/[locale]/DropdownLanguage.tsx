'use client';
import { Button, DropdownTrigger, Dropdown, DropdownMenu, DropdownItem } from '@heroui/react';
import { Globe, ChevronDown } from 'lucide-react';
import { locales } from '@/config/selection';

type Props = {
  locale: string;
  onChangeLocale: (code: string) => void;
  languageLabel: string;
};

export default function DropdownLanguage({ locale, onChangeLocale, languageLabel }: Props) {
  return (
    <Dropdown>
      <DropdownTrigger>
        <Button size="sm" variant="light" startContent={<Globe size={16} />} endContent={<ChevronDown size={16} />}>
          {locales.find((entry) => entry.code === locale)?.name || locale}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={languageLabel}>
        {locales.map((entry) => (
          <DropdownItem key={entry.code} onPress={() => onChangeLocale(entry.code)}>
            {entry.name}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
