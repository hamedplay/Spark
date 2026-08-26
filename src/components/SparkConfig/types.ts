export interface SparkModuleConfig {
  id: string;
  module: string;
  enabled: boolean;
  trigger_keywords: string[];
  description: string;
  voice_response_template: string;
  updated_at: string;
}

export interface FieldKeyword {
  id: string;
  module: string;
  field_key: string;
  field_label: string;
  extract_keywords: string[];
  example: string;
  sort_order: number;
}

export interface SparkAiSettings {
  id: string;
  provider: string;
  api_key: string;
  model: string;
  enabled: boolean;
}
