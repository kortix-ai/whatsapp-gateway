output "url" {
  value = "https://${var.domain}"
}

output "instance_id" {
  value = aws_instance.gateway.id
}

output "public_ip" {
  value = aws_eip.gateway.public_ip
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "secret_arn" {
  value = aws_secretsmanager_secret.gateway.arn
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.id
}
