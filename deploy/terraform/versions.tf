terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "kortix-whatsapp-gateway-tfstate-935064898258"
    key            = "wag.kortix.cloud/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "kortix-whatsapp-gateway-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "cloudflare" {}
