import { logError } from '@/utils/errorHandler';
import Config from '@/config/config';
const apiServer = Config.apiServer;

export type AccessTokenScope = 'read' | 'write';

export type AccessTokenMetadata = {
  id: number;
  name: string | null;
  tokenPrefix: string;
  scopes: AccessTokenScope[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type AccessTokenCreation = AccessTokenMetadata & {
  secret: string;
};

export type AccessTokenCreateInput = {
  name?: string;
  scopes: AccessTokenScope[];
  expiresInDays: number;
};

async function throwAccessTokenError(response: Response, fallbackMessage: string): Promise<never> {
  let message = fallbackMessage;
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error) {
      message = data.error;
    }
  } catch {
    // Keep the safe fallback when the API does not return JSON.
  }
  throw new Error(message);
}

async function listAccessTokens(jwt: string): Promise<AccessTokenMetadata[]> {
  const url = `${apiServer}/users/access-tokens`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!response.ok) {
      return throwAccessTokenError(response, `HTTP error! Status: ${response.status}`);
    }
    return (await response.json()) as AccessTokenMetadata[];
  } catch (error: unknown) {
    logError('Error listing access tokens:', error);
    throw error;
  }
}

async function createAccessToken(jwt: string, input: AccessTokenCreateInput): Promise<AccessTokenCreation> {
  const url = `${apiServer}/users/access-tokens`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      return throwAccessTokenError(response, `HTTP error! Status: ${response.status}`);
    }
    return (await response.json()) as AccessTokenCreation;
  } catch (error: unknown) {
    logError('Error creating access token:', error);
    throw error;
  }
}

async function revokeAccessToken(jwt: string, tokenId: number): Promise<void> {
  const url = `${apiServer}/users/access-tokens/${tokenId}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!response.ok) {
      return throwAccessTokenError(response, `HTTP error! Status: ${response.status}`);
    }
  } catch (error: unknown) {
    logError('Error revoking access token:', error);
    throw error;
  }
}

async function findUser(jwt: string, userId: number) {
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  };

  const url = `${apiServer}/users/find/${userId}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function searchUsers(jwt: string, projectId: number, searchText: string) {
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  };

  const url = `${apiServer}/users/search?projectId=${projectId}&search=${searchText}`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function updateUserRole(jwt: string, userId: number, newRole: number) {
  const updateUserData = {
    newRole,
  };

  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateUserData),
  };

  const url = `${apiServer}/users/${userId}/role`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error fetching data:', error);
  }
}

async function updateUsername(jwt: string, username: string) {
  const updateData = {
    username,
  };

  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateData),
  };

  const url = `${apiServer}/users/username`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error updating username:', error);
    throw error;
  }
}

async function updatePassword(jwt: string, currentPassword: string, newPassword: string) {
  const updateData = {
    currentPassword,
    newPassword,
  };

  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateData),
  };

  const url = `${apiServer}/users/password`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error updating password:', error);
    throw error;
  }
}

async function uploadAvatar(jwt: string, file: File) {
  const formData = new FormData();
  formData.append('avatar', file);

  const fetchOptions = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: formData,
  };

  const url = `${apiServer}/users/avatar`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error uploading avatar:', error);
    throw error;
  }
}

async function deleteAvatar(jwt: string) {
  const fetchOptions = {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  };

  const url = `${apiServer}/users/avatar`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error deleting avatar:', error);
    throw error;
  }
}

async function adminResetPassword(jwt: string, userId: number, newPassword: string) {
  const updateData = {
    newPassword,
  };

  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateData),
  };

  const url = `${apiServer}/users/${userId}/password`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error admin resetting password:', error);
    throw error;
  }
}

async function updateLocale(jwt: string, locale: string) {
  const updateData = {
    locale,
  };

  const fetchOptions = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(updateData),
  };

  const url = `${apiServer}/users/locale`;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: unknown) {
    logError('Error updating locale:', error);
    throw error;
  }
}

export {
  findUser,
  searchUsers,
  updateUserRole,
  updateUsername,
  updatePassword,
  uploadAvatar,
  deleteAvatar,
  adminResetPassword,
  updateLocale,
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
};
