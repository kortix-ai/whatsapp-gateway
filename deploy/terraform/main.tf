data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "cloudflare_zone" "gateway" {
  name = var.cloudflare_zone
}

data "cloudflare_ip_ranges" "cloudflare" {}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "random_password" "postgres" {
  length  = 40
  special = false
}

resource "random_password" "better_auth" {
  length  = 64
  special = false
}

resource "random_id" "encryption" {
  byte_length = 32
}

resource "aws_s3_bucket" "backups" {
  bucket = "kortix-whatsapp-gateway-backups-${data.aws_caller_identity.current.account_id}"
}

resource "aws_kms_key" "backups" {
  description             = "Encrypt whatsapp-gateway backups"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  tags = {
    Name    = "whatsapp-gateway-backups"
    Service = "wag.kortix.cloud"
  }
}

resource "aws_kms_alias" "backups" {
  name          = "alias/whatsapp-gateway-backups"
  target_key_id = aws_kms_key.backups.key_id
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.backups.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.backups.arn,
        "${aws_s3_bucket.backups.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.backups]
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = "kortix-whatsapp-gateway-tfstate-${data.aws_caller_identity.current.account_id}"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        "arn:aws:s3:::kortix-whatsapp-gateway-tfstate-${data.aws_caller_identity.current.account_id}",
        "arn:aws:s3:::kortix-whatsapp-gateway-tfstate-${data.aws_caller_identity.current.account_id}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

resource "aws_dynamodb_table" "terraform_locks" {
  name                        = "kortix-whatsapp-gateway-terraform-locks"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "LockID"
  deletion_protection_enabled = true

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name    = "kortix-whatsapp-gateway-terraform-locks"
    Service = "wag.kortix.cloud"
  }
}

import {
  to = aws_dynamodb_table.terraform_locks
  id = "kortix-whatsapp-gateway-terraform-locks"
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}
    expiration { days = 90 }
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
}

resource "aws_secretsmanager_secret" "gateway" {
  name                    = "whatsapp-gateway/production"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "gateway" {
  secret_id = aws_secretsmanager_secret.gateway.id
  secret_string = jsonencode({
    DOMAIN                   = var.domain
    POSTGRES_DB              = "whatsapp_gateway"
    POSTGRES_USER            = "whatsapp_gateway"
    POSTGRES_PASSWORD        = random_password.postgres.result
    DATABASE_URL             = "postgresql://whatsapp_gateway:${random_password.postgres.result}@postgres:5432/whatsapp_gateway"
    BETTER_AUTH_SECRET       = random_password.better_auth.result
    ENCRYPTION_KEY           = random_id.encryption.b64_std
    AUTH_ALLOWLIST_ENABLED   = "true"
    ALLOWED_EMAILS           = var.allowed_emails
    TRUSTED_PROXY_CIDRS      = join(",", var.trusted_proxy_cidrs)
    WORKER_CAPACITY          = "25"
    RECONNECT_STABLE_SECONDS = "300"
    PAIRING_TTL_SECONDS      = "300"
    WEBHOOK_MAX_ATTEMPTS     = "12"
    WEBHOOK_CONCURRENCY      = "10"
    AWS_REGION               = var.aws_region
    AWS_BACKUP_BUCKET        = aws_s3_bucket.backups.id
  })
}

resource "aws_iam_role" "instance" {
  name = "whatsapp-gateway-instance"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "instance" {
  name = "whatsapp-gateway-runtime"
  role = aws_iam_role.instance.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.gateway.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.backups.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.backups.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.backups.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "gateway" {
  name = "whatsapp-gateway"
  role = aws_iam_role.instance.name
}

resource "aws_security_group" "gateway" {
  name        = "whatsapp-gateway"
  description = "Public HTTP and HTTPS for Caddy; administration uses SSM"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP from Cloudflare"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = data.cloudflare_ip_ranges.cloudflare.ipv4_cidr_blocks
    ipv6_cidr_blocks = data.cloudflare_ip_ranges.cloudflare.ipv6_cidr_blocks
  }

  ingress {
    description      = "HTTPS from Cloudflare"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = data.cloudflare_ip_ranges.cloudflare.ipv4_cidr_blocks
    ipv6_cidr_blocks = data.cloudflare_ip_ranges.cloudflare.ipv6_cidr_blocks
  }

  ingress {
    description      = "HTTP/3 from Cloudflare"
    from_port        = 443
    to_port          = 443
    protocol         = "udp"
    cidr_blocks      = data.cloudflare_ip_ranges.cloudflare.ipv4_cidr_blocks
    ipv6_cidr_blocks = data.cloudflare_ip_ranges.cloudflare.ipv6_cidr_blocks
  }

  #trivy:ignore:AVD-AWS-0104 The gateway must reach WhatsApp, GHCR, AWS APIs, ACME, and package repositories whose public IP ranges are not stable.
  egress {
    description = "HTTPS service dependencies"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  #trivy:ignore:AVD-AWS-0104 Bootstrap package repositories publish changing public IP ranges; limit this exception to TCP port 80.
  egress {
    description = "HTTP package repositories"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_internet_gateway" "gateway" {
  vpc_id = data.aws_vpc.default.id
  tags   = { Name = "whatsapp-gateway" }
}

resource "aws_subnet" "gateway" {
  vpc_id                  = data.aws_vpc.default.id
  availability_zone       = "${var.aws_region}a"
  cidr_block              = "172.31.240.0/20"
  map_public_ip_on_launch = false
  tags                    = { Name = "whatsapp-gateway-public" }
}

resource "aws_route_table" "gateway" {
  vpc_id = data.aws_vpc.default.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gateway.id
  }
  tags = { Name = "whatsapp-gateway-public" }
}

resource "aws_route_table_association" "gateway" {
  subnet_id      = aws_subnet.gateway.id
  route_table_id = aws_route_table.gateway.id
}

resource "aws_instance" "gateway" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.gateway.id
  vpc_security_group_ids      = [aws_security_group.gateway.id]
  iam_instance_profile        = aws_iam_instance_profile.gateway.name
  associate_public_ip_address = true
  user_data_replace_on_change = false
  user_data = templatefile("${path.module}/cloud-init.sh.tftpl", {
    aws_region = var.aws_region
    secret_arn = aws_secretsmanager_secret.gateway.arn
  })

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 40
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name    = "whatsapp-gateway"
    Service = "wag.kortix.cloud"
  }

  depends_on = [aws_iam_role_policy.instance, aws_secretsmanager_secret_version.gateway]
}

resource "aws_eip" "gateway" {
  domain   = "vpc"
  instance = aws_instance.gateway.id
  tags     = { Name = "whatsapp-gateway" }
}

resource "cloudflare_record" "gateway" {
  zone_id = data.cloudflare_zone.gateway.id
  name    = trimsuffix(var.domain, ".${var.cloudflare_zone}")
  content = aws_eip.gateway.public_ip
  type    = "A"
  ttl     = 1
  proxied = true
}

# kortix.cloud has a wildcard Worker route. This more-specific no-script route
# lets the gateway reach its own Caddy origin instead of the generic proxy.
resource "cloudflare_worker_route" "gateway_bypass" {
  zone_id = data.cloudflare_zone.gateway.id
  pattern = "${var.domain}/*"
}

resource "aws_iam_role" "github_deploy" {
  name = "whatsapp-gateway-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "repo:${var.github_repository}:ref:refs/heads/main",
            "repo:kortix-ai@170767358/whatsapp-gateway@1307148265:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "whatsapp-gateway-ssm-deploy"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          aws_instance.gateway.arn,
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      }
    ]
  })
}
