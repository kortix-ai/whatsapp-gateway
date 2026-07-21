variable "aws_region" {
  description = "AWS region for the single-instance deployment."
  type        = string
  default     = "us-west-2"
}

variable "domain" {
  description = "Public gateway hostname."
  type        = string
  default     = "wag.kortix.cloud"
}

variable "cloudflare_zone" {
  description = "Cloudflare DNS zone containing the gateway hostname."
  type        = string
  default     = "kortix.cloud"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.small"
}

variable "allowed_emails" {
  description = "Comma-separated Better Auth signup allowlist."
  type        = string
  default     = "marko@kortix.ai"
}

variable "github_repository" {
  description = "GitHub owner/repository allowed to deploy through OIDC."
  type        = string
  default     = "kortix-ai/whatsapp-gateway"
}
