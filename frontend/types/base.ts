export type PageType = {
  params: {
    locale: string;
  };
};

export type GlobalRoleType = {
  uid: 'administrator' | 'user';
};

export type MemberRoleType = {
  uid: 'manager' | 'developer' | 'reporter';
};

export type AutomationStatusType = {
  uid: 'automated' | 'automation-not-required' | 'cannot-be-automated' | 'obsolete';
};

export type GherkinKeyword = 'given' | 'when' | 'then' | 'and' | 'but';
export type GherkinSection = 'background' | 'scenario';

export type TemplateType = {
  uid: 'text' | 'step' | 'gherkin';
};
