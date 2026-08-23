import { useTranslations } from 'next-intl';
import HeaderNavbarMenu from './HeaderNavbarMenu';
import { LocaleCodeType } from '@/types/locale';

export default function Header(params: { locale: LocaleCodeType }) {
  const t = useTranslations('Header');
  const ui = useTranslations('UI');
  const messages = {
    projects: t('projects'),
    admin: t('admin'),
    docs: t('docs'),
    roadmap: t('roadmap'),
    account: t('account'),
    profileSettings: t('profile_settings'),
    signUp: t('signup'),
    signIn: t('signin'),
    signOut: t('signout'),
    links: t('links'),
    languages: t('languages'),
    accountActionsSignedIn: ui('account_actions_signed_in'),
    accountActionsSignedOut: ui('account_actions_signed_out'),
    languageMenu: ui('language_menu'),
    linksAria: ui('links'),
    accountLinksAria: ui('account_links'),
    languageLinksAria: ui('language_links'),
    github: ui('github'),
  };

  return <HeaderNavbarMenu messages={messages} locale={params.locale} />;
}
