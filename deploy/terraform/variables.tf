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

variable "trusted_proxy_cidrs" {
  description = "CDN/reverse-proxy CIDRs trusted when resolving X-Forwarded-For. Defaults to Cloudflare's published ranges."
  type        = list(string)
  default = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22", "2400:cb00::/32",
    "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32",
  ]
}
