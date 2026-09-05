import Config from '@/config/config';

const apiServer = Config.apiServer;

export async function fetchRegistrationEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${apiServer}/users/registration-enabled`, { cache: 'no-store' });
    if (!response.ok) return false;

    const data = await response.json();
    return data.enabled === true;
  } catch (error) {
    console.error('Failed to fetch registration status', error);
    return false;
  }
}
