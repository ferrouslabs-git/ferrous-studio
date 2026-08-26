resource "aws_ecr_repository" "app" {
  name                 = local.product_name
  image_tag_mutability = "MUTABLE"
  # Lets `terraform destroy` remove the repo even with images pushed
  # (the default otherwise refuses to delete a non-empty repository).
  force_delete = true
}
