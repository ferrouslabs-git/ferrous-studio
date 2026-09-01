# Project documents: one private bucket per environment. The browser uploads
# and downloads directly against presigned URLs the API issues, so the bucket
# needs CORS for the app's origin (and localhost for staging, which local dev
# uses) but is never public.
resource "aws_s3_bucket" "documents" {
  for_each = toset(local.envs)
  bucket   = "${local.product_name}-documents-${each.key}"
  # Lets `terraform destroy` remove the bucket even with objects in it.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "documents" {
  for_each = toset(local.envs)
  bucket   = aws_s3_bucket.documents[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  for_each = toset(local.envs)
  bucket   = aws_s3_bucket.documents[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Abandoned browser uploads (multipart parts that never complete) are billed
# until cleaned up; a week is generous.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  for_each = toset(local.envs)
  bucket   = aws_s3_bucket.documents[each.key].id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# The presigned URL carries the signature; the browser still needs the bucket
# to answer its CORS preflight for PUT (upload) and GET (download). Until
# app.config.json's domain.root is set the app origin is the RFC 2606
# placeholder, so browser uploads only work from the localhost origins below
# (local dev targets the staging bucket) -- set the domain to unlock prod.
resource "aws_s3_bucket_cors_configuration" "documents" {
  for_each = toset(local.envs)
  bucket   = aws_s3_bucket.documents[each.key].id

  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["*"]
    allowed_origins = concat(
      [local.app_public_url[each.key]],
      each.key == "staging" ? ["http://localhost:8080", "http://localhost:5173"] : [],
    )
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
